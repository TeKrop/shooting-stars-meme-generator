// server-side export: hits /export/<hash>, which renders the animation
// with a native canvas + ffmpeg (see server/export.ts) — no headless
// browser, so this is fast enough that the progress dialog is only up for
// roughly as long as the render + download take, not ~25s.

// deliberately not imported from server/export.ts — this file keeps the
// client/server type boundary hard-separated, same as elsewhere in client/
type Orientation = "landscape" | "portrait";
type Resolution = "360p" | "480p" | "720p";
type FrameRate = 15 | 24 | 60;
type ExportFormat = "mp4" | "webm" | "gif";

type ExportOptions = {
	orientation: Orientation;
	resolution: Resolution;
	fps: FrameRate;
	format: ExportFormat;
};

// keyed by the specific HTTP status server/server.ts's '/export/*' route can
// return, so the user sees why it failed rather than one generic message
const EXPORT_ERROR_MESSAGES: Record<number, string> = {
	404: "Couldn't find that image anymore — try uploading it again.",
	429: "An export is already in progress. Please try again shortly.",
};
const DEFAULT_EXPORT_ERROR = "Couldn't export the animation. Please try again.";
const EXPORT_ERROR_DISMISS_MS = 6000;
const PROGRESS_POLL_MS = 200;

// GIF's palette-generation pass + poor compression for video-like content
// make high resolution/framerate impractically slow and huge (measured:
// ~146s/~324MB for 1080p/60fps GIF vs ~20s/~6MB for the same settings as
// WebM) — mirrors the server-side cap in server/export.ts's clampForGif(),
// which is what actually enforces this; this is just the matching UI
const GIF_MAX_RESOLUTION: Resolution = "360p";
const GIF_MAX_FPS: FrameRate = 24;
const RESOLUTION_ORDER: Resolution[] = ["360p", "480p", "720p"];

// mirrors server/export.ts's FRAME_PROGRESS_CAP — ffmpeg's own post-last-
// frame work (palette generation + encoding for GIF especially) keeps
// running for a few real seconds after frame-piping progress tops out here,
// so the label swaps to a "still working" message instead of sitting on a
// frozen percentage that reads as stuck/broken
const FRAME_PROGRESS_CAP = 95;

export function initExport() {
	const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;

	const optionsDialog = document.getElementById(
		"export-options-dialog",
	) as HTMLDialogElement;
	const optionsCancelBtn = document.getElementById(
		"export-options-cancel",
	) as HTMLButtonElement;
	const optionsStartBtn = document.getElementById(
		"export-options-start",
	) as HTMLButtonElement;
	const optionGroups = optionsDialog.querySelectorAll<HTMLElement>(
		".option-row[data-option]",
	);

	const progressDialog = document.getElementById(
		"export-progress-dialog",
	) as HTMLDialogElement;
	const progressBar = document.getElementById(
		"export-progress-bar",
	) as HTMLProgressElement;
	const progressLabel = document.getElementById(
		"export-progress-label",
	) as HTMLElement;

	// no cancel action exists (aborting a render mid-flight isn't wired up),
	// so block the Escape-key dismissal a native <dialog> offers by default —
	// the dialog only closes when runExport() is done, via close() below
	progressDialog.addEventListener("cancel", (e) => e.preventDefault());

	// reuses the same toast element preview.ts uses for upload errors — it's
	// a generic dismissible message, not upload-specific despite the id
	const errorToast = document.getElementById("upload-error") as HTMLElement;
	const errorToastText = errorToast.querySelector("p") as HTMLParagraphElement;
	let errorToastTimeout: ReturnType<typeof setTimeout> | null = null;

	function showError(message: string) {
		errorToastText.textContent = message;
		errorToast.classList.remove("toast-success");
		errorToast.hidden = false;
		if (errorToastTimeout) clearTimeout(errorToastTimeout);
		errorToastTimeout = setTimeout(() => {
			errorToast.hidden = true;
		}, EXPORT_ERROR_DISMISS_MS);
	}

	// generalizes the erase/pick tool-button aria-pressed toggling in
	// transparency.ts from two fixed buttons to N data-driven ones per group
	function selectOption(group: HTMLElement, value: string) {
		for (const btn of group.querySelectorAll<HTMLButtonElement>("button")) {
			btn.setAttribute("aria-pressed", String(btn.dataset.value === value));
		}
	}

	function getSelected(group: HTMLElement): string {
		const pressed = group.querySelector<HTMLButtonElement>(
			'button[aria-pressed="true"]',
		);
		return pressed?.dataset.value ?? "";
	}

	const resolutionGroup = optionsDialog.querySelector(
		'.option-row[data-option="resolution"]',
	) as HTMLElement;
	const fpsGroup = optionsDialog.querySelector(
		'.option-row[data-option="fps"]',
	) as HTMLElement;
	const formatGroup = optionsDialog.querySelector(
		'.option-row[data-option="format"]',
	) as HTMLElement;

	// disables the resolution/framerate options above the GIF cap when GIF
	// is selected (falling back the current selection if it's now disabled),
	// re-enables them otherwise
	function applyGifCap() {
		const isGif = getSelected(formatGroup) === "gif";

		for (const btn of resolutionGroup.querySelectorAll<HTMLButtonElement>(
			"button",
		)) {
			btn.disabled =
				isGif &&
				RESOLUTION_ORDER.indexOf(btn.dataset.value as Resolution) >
					RESOLUTION_ORDER.indexOf(GIF_MAX_RESOLUTION);
		}
		for (const btn of fpsGroup.querySelectorAll<HTMLButtonElement>("button")) {
			btn.disabled = isGif && Number(btn.dataset.value) > GIF_MAX_FPS;
		}

		if (isGif) {
			if (
				RESOLUTION_ORDER.indexOf(getSelected(resolutionGroup) as Resolution) >
				RESOLUTION_ORDER.indexOf(GIF_MAX_RESOLUTION)
			) {
				selectOption(resolutionGroup, GIF_MAX_RESOLUTION);
			}
			if (Number(getSelected(fpsGroup)) > GIF_MAX_FPS) {
				selectOption(fpsGroup, String(GIF_MAX_FPS));
			}
		}
	}

	for (const group of optionGroups) {
		group.querySelector(".tool-picker")?.addEventListener("click", (e) => {
			const btn = (e.target as HTMLElement).closest("button");
			if (!btn || btn.disabled) return;
			selectOption(group, btn.dataset.value ?? "");
			if (group === formatGroup) applyGifCap();
		});
	}

	const orientationGroup = optionsDialog.querySelector(
		'.option-row[data-option="orientation"]',
	) as HTMLElement;

	exportBtn.addEventListener("click", () => {
		if (exportBtn.disabled) return;

		// default orientation is keyed off device type (mobile -> landscape,
		// everything else -> portrait), not the current viewport orientation
		// — a deliberate product choice, still overridable in the dialog.
		// Same isMobile check as preview.ts's source-step (hover:none +
		// coarse pointer, without a fine pointer also present, to avoid
		// misclassifying a touchscreen laptop/tablet that also has a
		// mouse/trackpad attached).
		const isMobile =
			window.matchMedia("(hover: none) and (pointer: coarse)").matches &&
			!window.matchMedia("(any-pointer: fine)").matches;
		selectOption(orientationGroup, isMobile ? "landscape" : "portrait");
		selectOption(resolutionGroup, "480p");
		selectOption(fpsGroup, "24");
		selectOption(formatGroup, "mp4");
		applyGifCap();

		optionsDialog.showModal();
	});

	optionsCancelBtn.addEventListener("click", () => {
		optionsDialog.close();
	});

	optionsStartBtn.addEventListener("click", () => {
		const options: ExportOptions = {
			orientation: getSelected(orientationGroup) as Orientation,
			resolution: getSelected(resolutionGroup) as Resolution,
			fps: Number(getSelected(fpsGroup)) as FrameRate,
			format: getSelected(formatGroup) as ExportFormat,
		};
		optionsDialog.close();
		runExport(options);
	});

	function setProgress(percent: number) {
		progressBar.value = percent;
		progressLabel.textContent =
			percent >= FRAME_PROGRESS_CAP && percent < 100
				? "Finalizing…"
				: `${percent}%`;
	}

	async function pollProgress(): Promise<void> {
		try {
			const res = await fetch("/export-status");
			const { percent } = (await res.json()) as { percent: number };
			setProgress(percent);
		} catch {
			// a missed tick just leaves the last known percentage on screen
		}
	}

	async function runExport({
		orientation,
		resolution,
		fps,
		format,
	}: ExportOptions) {
		exportBtn.disabled = true;
		setProgress(0);
		// showModal() makes the rest of the page inert on its own — nothing
		// else is reachable by click or keyboard while a render is in flight
		progressDialog.showModal();
		const progressTimer = setInterval(pollProgress, PROGRESS_POLL_MS);

		const hash =
			window.location.pathname !== "/" ? window.location.pathname.slice(1) : "";

		try {
			const res = await fetch(
				`/export/${hash}?orientation=${orientation}&resolution=${resolution}&fps=${fps}&format=${format}`,
			);
			if (!res.ok) {
				showError(EXPORT_ERROR_MESSAGES[res.status] ?? DEFAULT_EXPORT_ERROR);
				return;
			}

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${hash || "doge"}.${format}`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			showError(DEFAULT_EXPORT_ERROR);
		} finally {
			clearInterval(progressTimer);
			progressDialog.close();
			exportBtn.disabled = false;
		}
	}
}
