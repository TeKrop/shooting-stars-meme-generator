// The preview dialog: pick a file, crop it with cropperjs, optionally erase
// or color-pick it to transparent, then upload.
import Cropper, {
	type CropperCanvas,
	type CropperImage,
	type CropperSelection,
} from "cropperjs";
import { initTransparencyTools } from "./transparency";

// The dialog shows the image at this fraction of the crop zone. The
// boundary of the zone therefore stays visible around the image.
const IMAGE_FIT_SCALE = 0.8;

// Matches the `error` query parameter of the redirect to '/'. See the
// '/upload' handler in server.ts.
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
	invalid_type: "Only PNG images are supported. Please try again.",
	too_large: "This image is too large. Please try again with a smaller one.",
};
const DEFAULT_UPLOAD_ERROR = "Couldn't upload this image. Please try again.";
const SERVER_ERROR_MESSAGE =
	"Something went wrong on our end. Please try again.";
const NETWORK_ERROR_MESSAGE = "Couldn't reach the server. Please try again.";

const UPLOAD_ERROR_DISMISS_MS = 6000;

// Classifies a finished '/upload' response into a hash or a message. The
// dialog close and the onUploaded call stay outside this function.
function classifyUploadResult(
	res: Response,
): { hash: string } | { message: string } {
	if (res.status >= 500) return { message: SERVER_ERROR_MESSAGE };

	// fetch already followed the 303, so this is the final URL. A bare '/'
	// means the server rejected the upload. The `error` query parameter
	// gives the reason.
	const url = new URL(res.url);
	const hash = url.pathname.slice(1);
	if (hash) return { hash };

	const reason = url.searchParams.get("error") ?? "";
	return { message: UPLOAD_ERROR_MESSAGES[reason] ?? DEFAULT_UPLOAD_ERROR };
}

export function initPreviewDialog(onUploaded: (hash: string) => void) {
	const fileInput = document.getElementById("file-upload") as HTMLInputElement;
	const previewDialog = document.getElementById(
		"preview-dialog",
	) as HTMLDialogElement;
	const previewImg = document.getElementById("preview-img") as HTMLImageElement;
	const cropArea = document.getElementById("crop-area") as HTMLElement;
	const sourceStep = document.getElementById("source-step") as HTMLElement;
	const sourceDropZone = document.getElementById(
		"source-drop-zone",
	) as HTMLElement;
	const sourceBrowseBtn = document.getElementById(
		"source-browse-btn",
	) as HTMLButtonElement;
	const sourceError = document.getElementById("source-error") as HTMLElement;
	const uploadTriggers =
		document.querySelectorAll<HTMLButtonElement>(".upload-trigger");
	const cropStep = document.getElementById("crop-step") as HTMLElement;
	const editStep = document.getElementById("edit-step") as HTMLElement;
	const editCanvas = document.getElementById(
		"edit-canvas",
	) as HTMLCanvasElement;
	const editCtx = editCanvas.getContext("2d") as CanvasRenderingContext2D;

	const cancelBtn = document.getElementById(
		"preview-cancel",
	) as HTMLButtonElement;
	const backBtn = document.getElementById("edit-back") as HTMLButtonElement;
	const nextBtn = document.getElementById("crop-next") as HTMLButtonElement;
	const uploadBtn = document.getElementById(
		"preview-confirm",
	) as HTMLButtonElement;

	const uploadError = document.getElementById("upload-error") as HTMLElement;
	const uploadErrorText = uploadError.querySelector(
		"p",
	) as HTMLParagraphElement;
	const uploadErrorClose = document.getElementById(
		"upload-error-close",
	) as HTMLElement;

	const { reset: resetTransparencyTools } = initTransparencyTools(editCanvas);

	let objectUrl: string | null = null;
	let cropper: Cropper | null = null;
	let uploadErrorTimeout: ReturnType<typeof setTimeout> | null = null;

	function showUploadError(message: string) {
		uploadErrorText.textContent = message;
		uploadError.classList.remove("toast-success");
		uploadError.hidden = false;
		if (uploadErrorTimeout) clearTimeout(uploadErrorTimeout);
		uploadErrorTimeout = setTimeout(() => {
			uploadError.hidden = true;
		}, UPLOAD_ERROR_DISMISS_MS);
	}

	uploadErrorClose.onclick = () => {
		uploadError.hidden = true;
		if (uploadErrorTimeout) clearTimeout(uploadErrorTimeout);
	};

	function showSourceError(message: string) {
		sourceError.textContent = message;
		sourceError.hidden = false;
	}

	function openPreviewWithFile(file: File) {
		if (!file.type.startsWith("image/")) {
			showSourceError("Please choose an image file.");
			return;
		}

		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = URL.createObjectURL(file);
		previewImg.src = objectUrl;
		showCropStep();
		if (!previewDialog.open) previewDialog.showModal();
	}

	function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) {
					e.preventDefault();
					openPreviewWithFile(file);
				}
				return;
			}
		}
		// The clipboard held content, but no image. Copied text does this.
		showSourceError("Clipboard doesn't contain an image.");
	}

	type Step = "source" | "crop" | "edit";

	// Holds the visible state of the three steps and their navigation buttons
	// in one place, instead of six flags set by hand at each entry point.
	function setStep(step: Step) {
		sourceStep.hidden = step !== "source";
		cropStep.hidden = step !== "crop";
		editStep.hidden = step !== "edit";
		nextBtn.hidden = step !== "crop";
		backBtn.hidden = step !== "edit";
		uploadBtn.hidden = step !== "edit";

		if (step === "source") {
			previewDialog.addEventListener("paste", handlePaste);
		} else {
			previewDialog.removeEventListener("paste", handlePaste);
			sourceError.hidden = true;
		}
	}

	function openSourceStep() {
		setStep("source");
		// An earlier upload in this dialog session can leave this button
		// disabled. The reset keeps a new upload cancelable.
		cancelBtn.disabled = false;
		previewDialog.showModal();
	}

	// A device with no precise pointer can reach neither drag and drop nor
	// paste, which are the purpose of the source step. Computed once: the
	// input hardware does not change during a dialog session.
	// Both queries must agree. The any-pointer half keeps a touchscreen
	// laptop with a mouse attached on the full desktop flow.
	const isMobile =
		window.matchMedia("(hover: none) and (pointer: coarse)").matches &&
		!window.matchMedia("(any-pointer: fine)").matches;

	for (const btn of uploadTriggers) {
		btn.onclick = isMobile ? () => fileInput.click() : openSourceStep;
	}

	sourceBrowseBtn.onclick = () => fileInput.click();

	sourceDropZone.ondragover = (e) => {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
		sourceDropZone.classList.add("is-drag-over");
	};
	sourceDropZone.ondragleave = () => {
		sourceDropZone.classList.remove("is-drag-over");
	};
	sourceDropZone.ondrop = (e) => {
		e.preventDefault();
		sourceDropZone.classList.remove("is-drag-over");
		const file = e.dataTransfer?.files[0];
		if (file) openPreviewWithFile(file);
	};

	fileInput.onchange = () => {
		const file = fileInput.files?.[0];
		if (file) openPreviewWithFile(file);
	};

	// Covers the Cancel button. Also covers the native Escape key close of
	// the <dialog> element.
	previewDialog.onclose = () => {
		cropper?.destroy();
		cropper = null;
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = null;
		fileInput.value = "";
		previewDialog.removeEventListener("paste", handlePaste);
		sourceError.hidden = true;
	};

	cancelBtn.onclick = () => previewDialog.close();

	function showCropStep() {
		setStep("crop");
		// An earlier upload in this dialog session can leave these flags
		// set. The reset keeps a new upload usable.
		uploadBtn.disabled = false;
		uploadBtn.classList.remove("is-loading");
		cancelBtn.disabled = false;
		backBtn.disabled = false;

		cropper?.destroy();
		const thisCropper = new Cropper(previewImg, { container: cropArea });
		cropper = thisCropper;

		// Selects the bounds of the image exactly. A plain full-canvas
		// selection would reach into the empty letterbox margin whenever the
		// two aspect ratios differ, adding transparent space to the result.
		const cropperImage = thisCropper.getCropperImage() as CropperImage;
		const selection = thisCropper.getCropperSelection() as CropperSelection;
		cropperImage.$ready(() => {
			// The internal image-load handler of cropper.js recenters the
			// image at an unscaled "contain" fit, and on a cached image it
			// can run *after* $ready. Two frames land after it reliably.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (cropper !== thisCropper) return; // A newer step replaced this one.
					cropperImage.$center("contain").$scale(IMAGE_FIT_SCALE);
					const canvasRect = (
						thisCropper.getCropperCanvas() as CropperCanvas
					).getBoundingClientRect();
					const imageRect = cropperImage.getBoundingClientRect();
					selection.$change(
						imageRect.left - canvasRect.left,
						imageRect.top - canvasRect.top,
						imageRect.width,
						imageRect.height,
					);
				});
			});
		});
	}

	nextBtn.onclick = async () => {
		const canvas = await (
			(cropper as Cropper).getCropperSelection() as CropperSelection
		).$toCanvas();
		cropper?.destroy();
		cropper = null;

		editCanvas.width = canvas.width;
		editCanvas.height = canvas.height;
		editCtx.drawImage(canvas, 0, 0);

		setStep("edit");

		// Must run after editStep becomes visible. The code sizes the erase
		// cursor from the displayed rect of the canvas. That rect is 0x0
		// while the step stays hidden.
		resetTransparencyTools();
	};

	backBtn.onclick = showCropStep;

	uploadBtn.onclick = async () => {
		// Stops a second submit. Also stops a stray navigation from a click
		// on Cancel or Back during the upload.
		uploadBtn.disabled = true;
		uploadBtn.classList.add("is-loading");
		cancelBtn.disabled = true;
		backBtn.disabled = true;

		const blob = await new Promise<Blob>((resolve) => {
			editCanvas.toBlob((b) => resolve(b as Blob), "image/png");
		});

		const formData = new FormData();
		// The server accepts PNG uploads only. This filename gives the
		// multipart part its image/png Content-Type.
		formData.set("file-upload", blob, "cropped.png");

		try {
			const res = await fetch("/upload", {
				method: "POST",
				body: formData,
			});
			const result = classifyUploadResult(res);
			previewDialog.close();
			if ("hash" in result) onUploaded(result.hash);
			else showUploadError(result.message);
		} catch {
			previewDialog.close();
			showUploadError(NETWORK_ERROR_MESSAGE);
		}
	};
}
