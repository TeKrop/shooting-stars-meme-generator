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

// The copy-link control. It reuses the toast element of preview.ts and
// export.ts. That element shows any dismissible message, not errors alone.
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
	// Clipboard access needs a secure context, over HTTPS or on localhost.
	// The user can also deny it. Each case deserves its own message.
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
 * Swaps in a new upload without a page reload: updates each picture src,
 * updates the URL so the link stays shareable, then launches the animation
 * at once so the upload feels instant.
 */
function applyUploadedImage(hash: string) {
	const src = `uploads/${hash}`;
	for (let i = 1; i <= nbPictures; i++) {
		(document.getElementById(`pict${i}`) as HTMLImageElement).src = src;
	}
	history.pushState(null, "", `/${hash}`);
	startAnimation();
}
