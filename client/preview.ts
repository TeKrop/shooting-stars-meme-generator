// preview dialog: crop the picked image (cropperjs) then optionally
// erase/color-pick it to transparent, before actually uploading it
import Cropper, {
	type CropperCanvas,
	type CropperImage,
	type CropperSelection,
} from "cropperjs";
import { initTransparencyTools } from "./transparency";

// the image is shown at this fraction of the crop zone, so its boundary
// stays visible around the image instead of the image filling it edge-to-edge
const IMAGE_FIT_SCALE = 0.8;

// matches the `error` query param the server redirects to '/' with (see
// server.ts's '/upload' handler)
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
	invalid_type: "Only PNG images are supported. Please try again.",
	too_large: "This image is too large. Please try again with a smaller one.",
};
const DEFAULT_UPLOAD_ERROR = "Couldn't upload this image. Please try again.";
const SERVER_ERROR_MESSAGE =
	"Something went wrong on our end. Please try again.";
const NETWORK_ERROR_MESSAGE = "Couldn't reach the server. Please try again.";

const UPLOAD_ERROR_DISMISS_MS = 6000;

export function initPreviewDialog(onUploaded: (hash: string) => void) {
	const fileInput = document.getElementById("file-upload") as HTMLInputElement;
	const previewDialog = document.getElementById(
		"preview-dialog",
	) as HTMLDialogElement;
	const previewImg = document.getElementById("preview-img") as HTMLImageElement;
	const cropArea = document.getElementById("crop-area") as HTMLElement;
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

	fileInput.onchange = () => {
		const file = fileInput.files?.[0];
		if (!file) return;

		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = URL.createObjectURL(file);
		previewImg.src = objectUrl;
		showCropStep();
		previewDialog.showModal();
	};

	// covers both the Cancel button and native Escape-to-close on <dialog>
	previewDialog.onclose = () => {
		cropper?.destroy();
		cropper = null;
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = null;
		fileInput.value = "";
	};

	cancelBtn.onclick = () => previewDialog.close();

	function showCropStep() {
		cropStep.hidden = false;
		editStep.hidden = true;
		nextBtn.hidden = false;
		backBtn.hidden = true;
		uploadBtn.hidden = true;
		// a previous upload in this same dialog session may have left these
		// set — reset them so a fresh upload isn't stuck disabled/loading
		uploadBtn.disabled = false;
		uploadBtn.classList.remove("is-loading");
		cancelBtn.disabled = false;
		backBtn.disabled = false;

		cropper?.destroy();
		const thisCropper = new Cropper(previewImg, { container: cropArea });
		cropper = thisCropper;

		// by default, select exactly the image's own bounds — a plain
		// full-canvas selection would extend into the letterboxed empty
		// margin whenever the image's aspect ratio doesn't match the crop
		// zone's, adding that empty area as extra transparent space to
		// anyone who clicks Next without adjusting the crop themselves
		const cropperImage = thisCropper.getCropperImage() as CropperImage;
		const selection = thisCropper.getCropperSelection() as CropperSelection;
		cropperImage.$ready(() => {
			// cropper.js's own internal image-load handler also re-centers
			// the image (to a plain, unscaled "contain" fit) — on a cached
			// image (e.g. re-entering this step via Back) that handler can
			// fire *after* $ready's callback instead of before, silently
			// undoing our scale/selection if we apply them immediately. Two
			// animation frames reliably land after that internal handler.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (cropper !== thisCropper) return; // superseded by a newer step
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

		cropStep.hidden = true;
		editStep.hidden = false;
		nextBtn.hidden = true;
		backBtn.hidden = false;
		uploadBtn.hidden = false;

		// must run after editStep is unhidden: the erase cursor is sized from
		// the canvas's displayed rect, which is 0x0 while hidden
		resetTransparencyTools();
	};

	backBtn.onclick = showCropStep;

	uploadBtn.onclick = async () => {
		// prevent double-submit and a stray navigation if Cancel/Back were
		// clicked while the upload is still in flight
		uploadBtn.disabled = true;
		uploadBtn.classList.add("is-loading");
		cancelBtn.disabled = true;
		backBtn.disabled = true;

		const blob = await new Promise<Blob>((resolve) => {
			editCanvas.toBlob((b) => resolve(b as Blob), "image/png");
		});

		const formData = new FormData();
		// the server only accepts PNG uploads, keyed off this filename's
		// extension (not the Blob's own declared `type`)
		formData.set("file-upload", blob, "cropped.png");

		try {
			const res = await fetch("/upload", {
				method: "POST",
				body: formData,
			});

			if (res.status >= 500) {
				previewDialog.close();
				showUploadError(SERVER_ERROR_MESSAGE);
				return;
			}

			// fetch already followed the 303, so this is the final URL —
			// a bare '/' means the upload was rejected server-side (see
			// the `error` query param for why)
			const url = new URL(res.url);
			const hash = url.pathname.slice(1);
			if (hash) {
				previewDialog.close();
				onUploaded(hash);
				return;
			}

			previewDialog.close();
			const reason = url.searchParams.get("error") ?? "";
			showUploadError(UPLOAD_ERROR_MESSAGES[reason] ?? DEFAULT_UPLOAD_ERROR);
		} catch {
			previewDialog.close();
			showUploadError(NETWORK_ERROR_MESSAGE);
		}
	};
}
