// preview dialog: crop the picked image (cropper.js) then optionally
// erase/color-pick it to transparent, before actually uploading it
import Cropper from 'cropperjs';
import { initTransparencyTools } from './transparency';

// the image is shown at this fraction of the crop zone, so its boundary
// stays visible around the image instead of the image filling it edge-to-edge
const IMAGE_FIT_SCALE = 0.8;

export function initPreviewDialog() {
    const fileInput = document.getElementById(
        'file-upload',
    ) as HTMLInputElement;
    const previewDialog = document.getElementById(
        'preview-dialog',
    ) as HTMLDialogElement;
    const previewImg = document.getElementById(
        'preview-img',
    ) as HTMLImageElement;
    const cropArea = document.getElementById('crop-area') as HTMLElement;
    const cropStep = document.getElementById('crop-step') as HTMLElement;
    const editStep = document.getElementById('edit-step') as HTMLElement;
    const editCanvas = document.getElementById(
        'edit-canvas',
    ) as HTMLCanvasElement;
    const editCtx = editCanvas.getContext('2d')!;

    const cancelBtn = document.getElementById(
        'preview-cancel',
    ) as HTMLButtonElement;
    const backBtn = document.getElementById('edit-back') as HTMLButtonElement;
    const nextBtn = document.getElementById('crop-next') as HTMLButtonElement;
    const uploadBtn = document.getElementById(
        'preview-confirm',
    ) as HTMLButtonElement;

    const { reset: resetTransparencyTools } = initTransparencyTools(editCanvas);

    let objectUrl: string | null = null;
    let cropper: Cropper | null = null;

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
        fileInput.value = '';
    };

    cancelBtn.onclick = () => previewDialog.close();

    function showCropStep() {
        cropStep.hidden = false;
        editStep.hidden = true;
        nextBtn.hidden = false;
        backBtn.hidden = true;
        uploadBtn.hidden = true;

        cropper?.destroy();
        const thisCropper = new Cropper(previewImg, { container: cropArea });
        cropper = thisCropper;

        // by default, select exactly the image's own bounds — a plain
        // full-canvas selection would extend into the letterboxed empty
        // margin whenever the image's aspect ratio doesn't match the crop
        // zone's, adding that empty area as extra transparent space to
        // anyone who clicks Next without adjusting the crop themselves
        const cropperImage = thisCropper.getCropperImage()!;
        const selection = thisCropper.getCropperSelection()!;
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
                    cropperImage.$center('contain').$scale(IMAGE_FIT_SCALE);
                    const canvasRect = thisCropper
                        .getCropperCanvas()!
                        .getBoundingClientRect();
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
        const canvas = await cropper!.getCropperSelection()!.$toCanvas();
        cropper?.destroy();
        cropper = null;

        editCanvas.width = canvas.width;
        editCanvas.height = canvas.height;
        editCtx.drawImage(canvas, 0, 0);
        resetTransparencyTools();

        cropStep.hidden = true;
        editStep.hidden = false;
        nextBtn.hidden = true;
        backBtn.hidden = false;
        uploadBtn.hidden = false;
    };

    backBtn.onclick = showCropStep;

    uploadBtn.onclick = async () => {
        // prevent double-submit and a stray navigation if Cancel/Back were
        // clicked while the upload is still in flight
        uploadBtn.disabled = true;
        uploadBtn.classList.add('is-loading');
        cancelBtn.disabled = true;
        backBtn.disabled = true;

        const blob = await new Promise<Blob>((resolve) => {
            editCanvas.toBlob((b) => resolve(b!), 'image/png');
        });

        const formData = new FormData();
        // the server only accepts PNG uploads, keyed off this filename's
        // extension (not the Blob's own declared `type`)
        formData.set('file-upload', blob, 'cropped.png');

        try {
            const res = await fetch('/upload', {
                method: 'POST',
                body: formData,
            });
            window.location.assign(res.url);
        } catch {
            uploadBtn.disabled = false;
            uploadBtn.classList.remove('is-loading');
            cancelBtn.disabled = false;
            backBtn.disabled = false;
        }
    };
}
