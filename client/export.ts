// The client half of the export. It calls /export/<hash>, which renders the
// animation with a native canvas and ffmpeg (see server/export.ts). No
// headless browser, so the progress dialog is up only for render plus
// download.

// server/export.ts imports this same file across the client boundary, as it
// already does for animation-timeline.ts, so the option types and the GIF
// caps cannot drift apart. See export-options.ts.
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

// dataset.value is always a plain string, even for a numeric FrameRate
// option. This type is the string form. The code reads and writes DOM
// attributes with it. It also builds the size-estimate key below with it.
type FrameRateValue = `${FrameRate}`;

type ExportOptions = {
	orientation: Orientation;
	resolution: Resolution;
	fps: FrameRate;
	format: ExportFormat;
};

// Keyed by the HTTP status values that the '/export/*' route of
// server/server.ts returns. The user therefore sees the real reason. One
// generic message would hide it.
const EXPORT_ERROR_MESSAGES: Record<number, string> = {
	404: "Couldn't find that image anymore — try uploading it again.",
	429: "An export is already in progress. Please try again shortly.",
};
const DEFAULT_EXPORT_ERROR = "Couldn't export the animation. Please try again.";
const EXPORT_ERROR_DISMISS_MS = 6000;
const PROGRESS_POLL_MS = 200;

// Real measured GIF sizes, at the full 256-color palette with a
// bayer_scale=5 dither and no downscale. Only the pairs that the GIF cap
// allows have entries. Orientation does not change the pixel count, so one
// estimate per pair covers both.
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

	// No cancel action exists, so block the default Escape close of a native
	// <dialog>. Only the close() call in runExport() below dismisses it.
	progressDialog.addEventListener("cancel", (e) => e.preventDefault());

	// Reuses the toast element that preview.ts uses for upload errors. The
	// element shows any dismissible message. The id alone suggests otherwise.
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

	// Generalizes the aria-pressed toggle in transparency.ts from two fixed
	// buttons to any number driven by data attributes. Generic over the value
	// type of the group, so a caller gets a typed value back with no cast.
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

	// Shows a real size estimate for a GIF export. The encoder applies no
	// automatic size reduction, so this warning is what tells the user.
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

	// Disables every resolution and frame rate above the GIF cap while GIF is
	// selected, and moves the current selection down if it just went away.
	// The move reuses clampForGif, so the server cannot disagree on the cap.
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

		// The default orientation follows the device type, not the current
		// viewport: portrait on mobile, landscape elsewhere. A deliberate
		// product choice, still changeable in the dialog. Same isMobile test
		// as the source step of preview.ts.
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
			// A missed tick leaves the last known percentage on screen.
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
		// showModal() makes the rest of the page inert by itself. No click
		// and no key can reach another element during a render.
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
