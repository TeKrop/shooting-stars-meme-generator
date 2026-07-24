import { version } from "../package.json";
import { restartAnimation, startAnimation } from "./animation";
import { initExport } from "./export";
import { initPreviewDialog } from "./preview";
import { initVolumeControl } from "./volume";

const COPY_TOAST_DISMISS_MS = 4000;

function requireElement<T extends Element>(id: string): T {
	const el = document.getElementById(id);
	if (!el) throw new Error(`Missing #${id} element in index.html`);
	return el as unknown as T;
}

const picturesContainer = document.getElementById(
	"pictures-container",
) as HTMLElement;
const nbPictures = 6;
const imagePath =
	window.location.pathname !== "/"
		? `uploads${window.location.pathname}`
		: "img/doge.png";
for (let i = nbPictures; i >= 1; i--) {
	const img = document.createElement("img");
	img.setAttribute("src", imagePath);
	img.setAttribute("class", "hide");
	img.setAttribute("id", `pict${i}`);
	picturesContainer.appendChild(img);
}

requireElement<HTMLElement>("app-version").textContent = `v${version}`;

// copy-link: reuses the same toast element preview.ts/export.ts use for
// error messages — a generic dismissible message, not error-specific
const copyLinkBtn = requireElement<HTMLButtonElement>("copy-link-btn");
const copyToast = requireElement<HTMLElement>("upload-error");
const copyToastText = copyToast.querySelector("p") as HTMLParagraphElement;
let copyToastTimeout: ReturnType<typeof setTimeout> | null = null;

function showCopyToast() {
	copyToast.hidden = false;
	if (copyToastTimeout) clearTimeout(copyToastTimeout);
	copyToastTimeout = setTimeout(() => {
		copyToast.hidden = true;
	}, COPY_TOAST_DISMISS_MS);
}

copyLinkBtn.addEventListener("click", async () => {
	// clipboard access needs a secure context (HTTPS/localhost) and can be
	// denied by the user, so both are worth telling apart rather than one
	// generic failure message
	if (!navigator.clipboard) {
		copyToastText.textContent = "Clipboard isn't available in this browser.";
		copyToast.classList.remove("toast-success");
		showCopyToast();
		return;
	}
	try {
		await navigator.clipboard.writeText(window.location.href);
		copyToastText.textContent = "Link copied!";
		copyToast.classList.add("toast-success");
	} catch {
		copyToastText.textContent =
			"Couldn't copy the link — check clipboard permissions.";
		copyToast.classList.remove("toast-success");
	}
	showCopyToast();
});

restartAnimation();

initPreviewDialog(applyUploadedImage);
initExport();
initVolumeControl();

/**
 * Swaps in a freshly uploaded image without a full page reload: updates the
 * pictures' src, updates the URL to match (so the link stays shareable),
 * and launches the animation right away so the upload feels instant.
 */
function applyUploadedImage(hash: string) {
	const src = `uploads/${hash}`;
	for (let i = 1; i <= nbPictures; i++) {
		(document.getElementById(`pict${i}`) as HTMLImageElement).src = src;
	}
	history.pushState(null, "", `/${hash}`);
	startAnimation();
}
