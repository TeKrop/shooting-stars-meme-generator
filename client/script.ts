import { restartAnimation, startAnimation } from "./animation";
import { initPreviewDialog } from "./preview";

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

// init animation
restartAnimation();

initPreviewDialog(applyUploadedImage);

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
