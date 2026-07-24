// server-side export: hits /export/<hash>, which renders the animation
// with a native canvas + ffmpeg (see server/export.ts) — no headless
// browser, so this is fast enough that the progress dialog is only up for
// roughly as long as the render + download take, not ~25s.

type ExportFormat = "mp4" | "webm";

// keyed by the specific HTTP status server/server.ts's '/export/*' route can
// return, so the user sees why it failed rather than one generic message
const EXPORT_ERROR_MESSAGES: Record<number, string> = {
	404: "Couldn't find that image anymore — try uploading it again.",
	429: "An export is already in progress. Please try again shortly.",
};
const DEFAULT_EXPORT_ERROR = "Couldn't export the animation. Please try again.";
const EXPORT_ERROR_DISMISS_MS = 6000;
const PROGRESS_POLL_MS = 200;

export function initExport() {
	const exportGroup = document.getElementById("export-group") as HTMLElement;
	const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
	const exportMenu = document.getElementById("export-menu") as HTMLElement;

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
		errorToast.hidden = false;
		if (errorToastTimeout) clearTimeout(errorToastTimeout);
		errorToastTimeout = setTimeout(() => {
			errorToast.hidden = true;
		}, EXPORT_ERROR_DISMISS_MS);
	}

	function setMenuOpen(open: boolean) {
		exportMenu.hidden = !open;
		exportBtn.setAttribute("aria-expanded", String(open));
	}

	exportBtn.addEventListener("click", () => {
		if (exportBtn.disabled) return;
		setMenuOpen(!!exportMenu.hidden);
	});

	// closes the popover on any click outside the group, rather than wiring
	// per-option blur handling
	document.addEventListener("click", (e) => {
		if (!exportGroup.contains(e.target as Node)) setMenuOpen(false);
	});

	for (const option of exportMenu.querySelectorAll<HTMLButtonElement>(
		".export-option",
	)) {
		option.addEventListener("click", () => {
			setMenuOpen(false);
			runExport(option.dataset.format as ExportFormat);
		});
	}

	function setProgress(percent: number) {
		progressBar.value = percent;
		progressLabel.textContent = `${percent}%`;
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

	async function runExport(format: ExportFormat) {
		exportBtn.disabled = true;
		setProgress(0);
		// showModal() makes the rest of the page inert on its own — nothing
		// else is reachable by click or keyboard while a render is in flight
		progressDialog.showModal();
		const progressTimer = setInterval(pollProgress, PROGRESS_POLL_MS);

		const hash =
			window.location.pathname !== "/" ? window.location.pathname.slice(1) : "";
		const orientation = window.matchMedia("(orientation: portrait)").matches
			? "portrait"
			: "landscape";

		try {
			const res = await fetch(
				`/export/${hash}?orientation=${orientation}&format=${format}`,
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
