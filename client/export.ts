// server-side export: hits /export/<hash>, which renders the animation
// with a native canvas + ffmpeg (see server/export.ts) — no headless
// browser, so this is fast enough that the progress dialog is only up for
// roughly as long as the render + download take, not ~25s.

// shared with server/export.ts (which imports the same file across the
// client/server boundary, same as it already does for animation-timeline.ts)
// so the option types, GIF caps/ordering, and the clamping logic itself
// can't drift out of sync between the two — see export-options.ts
import {
	clampForGif,
	type ExportFormat,
	FRAME_PROGRESS_CAP,
	type FrameRate,
	GIF_MAX_FPS,
	GIF_MAX_RESOLUTION,
	type Orientation,
	RESOLUTION_ORDER,
	type Resolution,
} from "./export-options";

// dataset.value is always a plain string, even for the numeric FrameRate
// options — this is the string-keyed form used for reading/writing DOM
// attributes and building the size-estimate lookup key below
type FrameRateValue = `${FrameRate}`;

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

// real measured GIF sizes (full 256-color palette, bayer_scale=5 dither, no
// resolution scale-down) — only the combinations GIF actually allows
// (resolution capped to 480p, fps capped to 24) have entries. Orientation
// doesn't change total pixel count (e.g. 640x360 vs 360x640), so one
// estimate per resolution/fps pair covers both.
const GIF_SIZE_ESTIMATE_MB: Partial<
	Record<`${Resolution}:${FrameRateValue}`, number>
> = {
	"360p:15": 17,
	"360p:24": 26,
	"480p:15": 27,
	"480p:24": 42,
};

function estimateGifSizeMB(
	resolution: Resolution,
	fps: FrameRateValue,
): number | undefined {
	return GIF_SIZE_ESTIMATE_MB[`${resolution}:${fps}`];
}

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
	// transparency.ts from two fixed buttons to N data-driven ones per group.
	// Generic over the option-group's own value type (Orientation/Resolution/
	// FrameRateValue/ExportFormat) so callers get a real typed value back
	// instead of a bare string plus an `as` cast at every call site.
	function selectOption<T extends string>(group: HTMLElement, value: T) {
		for (const btn of group.querySelectorAll<HTMLButtonElement>("button")) {
			btn.setAttribute("aria-pressed", String(btn.dataset.value === value));
		}
	}

	function getSelected<T extends string>(group: HTMLElement): T {
		const pressed = group.querySelector<HTMLButtonElement>(
			'button[aria-pressed="true"]',
		);
		return (pressed?.dataset.value ?? "") as T;
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

	const gifWarning = document.getElementById("gif-size-warning") as HTMLElement;

	// shows a real size estimate whenever GIF is selected — full-resolution
	// GIF has no automatic size mitigation (see GIF_SIZE_ESTIMATE_MB above),
	// so the warning is what tells the user up front instead of a silent cap
	function updateGifWarning() {
		const isGif = getSelected<ExportFormat>(formatGroup) === "gif";
		if (!isGif) {
			gifWarning.hidden = true;
			return;
		}
		const estimate = estimateGifSizeMB(
			getSelected<Resolution>(resolutionGroup),
			getSelected<FrameRateValue>(fpsGroup),
		);
		gifWarning.textContent =
			estimate !== undefined
				? `⚠️ GIF at this resolution/framerate will be a large file — roughly ${estimate}MB.`
				: "⚠️ GIF exports produce large files.";
		gifWarning.hidden = false;
	}

	// disables the resolution/framerate options above the GIF cap when GIF
	// is selected (falling back the current selection if it's now disabled),
	// re-enables them otherwise. The fallback reuses clampForGif — the same
	// function server/export.ts's query-param validation enforces with — so
	// the two can't disagree on what counts as "too high" for GIF.
	function applyGifCap() {
		const isGif = getSelected<ExportFormat>(formatGroup) === "gif";

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
			const clamped = clampForGif(
				getSelected<Resolution>(resolutionGroup),
				Number(getSelected<FrameRateValue>(fpsGroup)) as FrameRate,
			);
			selectOption(resolutionGroup, clamped.resolution);
			selectOption(fpsGroup, String(clamped.fps) as FrameRateValue);
		}

		updateGifWarning();
	}

	for (const group of optionGroups) {
		group.querySelector(".tool-picker")?.addEventListener("click", (e) => {
			const btn = (e.target as HTMLElement).closest("button");
			if (!btn || btn.disabled) return;
			selectOption(group, btn.dataset.value ?? "");
			applyGifCap();
		});
	}

	const orientationGroup = optionsDialog.querySelector(
		'.option-row[data-option="orientation"]',
	) as HTMLElement;

	exportBtn.addEventListener("click", () => {
		if (exportBtn.disabled) return;

		// default orientation is keyed off device type (mobile -> portrait,
		// everything else -> landscape), not the current viewport orientation
		// — a deliberate product choice, still overridable in the dialog.
		// Same isMobile check as preview.ts's source-step (hover:none +
		// coarse pointer, without a fine pointer also present, to avoid
		// misclassifying a touchscreen laptop/tablet that also has a
		// mouse/trackpad attached).
		const isMobile =
			window.matchMedia("(hover: none) and (pointer: coarse)").matches &&
			!window.matchMedia("(any-pointer: fine)").matches;
		selectOption<Orientation>(
			orientationGroup,
			isMobile ? "portrait" : "landscape",
		);
		selectOption<Resolution>(resolutionGroup, "480p");
		selectOption<FrameRateValue>(fpsGroup, "24");
		selectOption<ExportFormat>(formatGroup, "mp4");
		applyGifCap();

		optionsDialog.showModal();
	});

	optionsCancelBtn.addEventListener("click", () => {
		optionsDialog.close();
	});

	optionsStartBtn.addEventListener("click", () => {
		const options: ExportOptions = {
			orientation: getSelected<Orientation>(orientationGroup),
			resolution: getSelected<Resolution>(resolutionGroup),
			fps: Number(getSelected<FrameRateValue>(fpsGroup)) as FrameRate,
			format: getSelected<ExportFormat>(formatGroup),
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
