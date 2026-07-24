import { version } from "../package.json";
import { restartAnimation, startAnimation } from "./animation";
import { initExport } from "./export";
import { initPreviewDialog } from "./preview";

const COPY_TOAST_DISMISS_MS = 4000;

// pictures
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

// the hidden file input can't rely on CSS's adjacent-sibling focus trick
// since it has two labels in different parts of the DOM (see .file-upload-focused
// in style.css) — toggling a class here works in every browser, unlike :has()
const fileUpload = document.getElementById("file-upload") as HTMLInputElement;
fileUpload.addEventListener("focus", () => {
	if (fileUpload.matches(":focus-visible")) {
		document.body.classList.add("file-upload-focused");
	}
});
fileUpload.addEventListener("blur", () => {
	document.body.classList.remove("file-upload-focused");
});

(document.getElementById("app-version") as HTMLElement).textContent =
	`v${version}`;

// copy-link: reuses the same toast element preview.ts/export.ts use for
// error messages — a generic dismissible message, not error-specific
const copyLinkBtn = document.getElementById(
	"copy-link-btn",
) as HTMLButtonElement;
const copyToast = document.getElementById("upload-error") as HTMLElement;
const copyToastText = copyToast.querySelector("p") as HTMLParagraphElement;
let copyToastTimeout: ReturnType<typeof setTimeout> | null = null;

copyLinkBtn.addEventListener("click", async () => {
	try {
		await navigator.clipboard.writeText(window.location.href);
		copyToastText.textContent = "Link copied!";
		copyToast.classList.add("toast-success");
	} catch {
		copyToastText.textContent = "Couldn't copy the link.";
		copyToast.classList.remove("toast-success");
	}
	copyToast.hidden = false;
	if (copyToastTimeout) clearTimeout(copyToastTimeout);
	copyToastTimeout = setTimeout(() => {
		copyToast.hidden = true;
	}, COPY_TOAST_DISMISS_MS);
});

// init animation
restartAnimation();

initPreviewDialog(applyUploadedImage);
initExport();

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
