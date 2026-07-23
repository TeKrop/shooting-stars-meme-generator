// server-side export: hits /export/<hash>, which renders the animation
// with a native canvas + ffmpeg (see server/export.ts) — no headless
// browser, so this is fast enough that the dock button's spinner is only
// up for roughly as long as the render + download take, not ~25s.

const EXPORT_ERROR_MESSAGE = "Couldn't export the animation. Please try again.";
const EXPORT_ERROR_DISMISS_MS = 6000;

export function initExport() {
	const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;

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

	exportBtn.addEventListener("click", runExport);

	async function runExport() {
		exportBtn.disabled = true;
		exportBtn.classList.add("is-loading");

		const hash =
			window.location.pathname !== "/" ? window.location.pathname.slice(1) : "";
		const orientation = window.matchMedia("(orientation: portrait)").matches
			? "portrait"
			: "landscape";

		try {
			const res = await fetch(`/export/${hash}?orientation=${orientation}`);
			if (!res.ok) {
				showError(EXPORT_ERROR_MESSAGE);
				return;
			}

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "shooting-stars.mp4";
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			showError(EXPORT_ERROR_MESSAGE);
		} finally {
			exportBtn.disabled = false;
			exportBtn.classList.remove("is-loading");
		}
	}
}
