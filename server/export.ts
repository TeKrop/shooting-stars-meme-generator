// Server-side animation export, without a headless browser: renders
// transparent RGBA frames with a native canvas (replicating stars.css's
// keyframes + animation.ts's stage timeline — see server/keyframes.ts) and
// pipes them into a single ffmpeg process that composites them over
// background.mp4 and encodes the result. This is why it can be near-instant
// where the old (abandoned) approach — recording the real page with
// Playwright — took ~20-27s per export: there's no real-time playback or
// browser to wait on, just compositing + a fast software encode.

import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
	ANIMATION_TIMELINE,
	pictureAnimationKey,
} from "../client/animation-timeline";
import { ANIMATIONS, resolvePictureFrame } from "./keyframes";

export type Orientation = "landscape" | "portrait";
// 720p is the max tier: background.mp4 itself is authored at 1280x720, so a
// 1080p export would just be upscaling the background for no real gain
export type Resolution = "360p" | "480p" | "720p";
export type FrameRate = 15 | 24 | 60;
export type ExportFormat = "mp4" | "webm" | "gif";

export const ORIENTATIONS: Orientation[] = ["landscape", "portrait"];
export const RESOLUTIONS: Resolution[] = ["360p", "480p", "720p"];
export const FRAME_RATES: FrameRate[] = [15, 24, 60];
export const EXPORT_FORMATS: ExportFormat[] = ["mp4", "webm", "gif"];

export const DEFAULT_ORIENTATION: Orientation = "landscape";
export const DEFAULT_RESOLUTION: Resolution = "480p";
export const DEFAULT_FPS: FrameRate = 24;
export const DEFAULT_FORMAT: ExportFormat = "mp4";

// GIF's palette-generation pass plus GIF's inherently poor compression for
// video-like content make high resolution/framerate impractically slow and
// huge: measured at ~146s/~324MB for 1080p/60fps, vs ~20s/~6MB for the same
// settings as WebM. Clamping GIF down keeps one format from blowing the
// render-time budget every other export relies on. 360p/24fps was measured
// at ~16.5s/~39MB — still the biggest file of any capped combination, but
// comfortably within the render-time budget.
export const GIF_MAX_RESOLUTION: Resolution = "360p";
export const GIF_MAX_FPS: FrameRate = 24;

const RESOLUTION_ORDER: Resolution[] = ["360p", "480p", "720p"];

export function clampForGif(
	resolution: Resolution,
	fps: FrameRate,
): { resolution: Resolution; fps: FrameRate } {
	return {
		resolution:
			RESOLUTION_ORDER.indexOf(resolution) >
			RESOLUTION_ORDER.indexOf(GIF_MAX_RESOLUTION)
				? GIF_MAX_RESOLUTION
				: resolution,
		fps: fps > GIF_MAX_FPS ? GIF_MAX_FPS : fps,
	};
}

// 480p is the original/default tier — kept unchanged from before resolution
// was configurable, for continuity with any bookmarked/shared export
// behavior. Every tier matches the export viewport's own aspect ratio
// (16:9 landscape / 9:16 portrait); bgFilter below always scales+crops the
// background down/up to match, regardless of orientation or tier.
const VIEWPORTS: Record<
	Orientation,
	Record<Resolution, { width: number; height: number }>
> = {
	landscape: {
		"360p": { width: 640, height: 360 },
		"480p": { width: 854, height: 480 },
		"720p": { width: 1280, height: 720 },
	},
	portrait: {
		"360p": { width: 360, height: 640 },
		"480p": { width: 480, height: 854 },
		"720p": { width: 720, height: 1280 },
	},
};

// matches base.css's `--travel-scale: clamp(0.25, calc(100vw / 1400px), 1)`
// — computed once per orientation since the export always uses a fixed
// viewport size (no responsive resize mid-render)
function travelScale(viewportWidth: number): number {
	return Math.min(1, Math.max(0.25, viewportWidth / 1400));
}

// matches base.css's `img { max-width: calc(30% / var(--travel-scale)) }`
// (and max-height, same formula against viewport height) — the box an
// uploaded image is fit into before the keyframe transform applies
function pictureBox(
	viewport: { width: number; height: number },
	scale: number,
) {
	return {
		width: (viewport.width * 0.3) / scale,
		height: (viewport.height * 0.3) / scale,
	};
}

// the last ANIMATION_TIMELINE offset is the loop point (stage swaps back
// to "init", matching the background video's own length / 'ended' event)
const EXPORT_DURATION_MS = Math.max(
	...Object.keys(ANIMATION_TIMELINE).map(Number),
);

const pictureIds = ["pict1", "pict2", "pict3", "pict4", "pict5", "pict6"];

// sorted ascending so findStage can do a simple linear scan for the last
// entry whose start is <= the current frame time — 8 entries, no need for
// anything fancier
const timeline = Object.entries(ANIMATION_TIMELINE)
	.map(([ms, stage]) => ({ startMs: Number(ms), ...stage }))
	.sort((a, b) => a.startMs - b.startMs);

function findStage(timeMs: number) {
	let active = timeline[0];
	for (const stage of timeline) {
		if (stage.startMs > timeMs) break;
		active = stage;
	}
	return active;
}

// leaves room for ffmpeg's own post-last-frame encoding work (see the
// onProgress call in renderFrames below) before jumping to a real 100%
const FRAME_PROGRESS_CAP = 95;

function cssFilterString(filter: {
	kind: "none" | "saturate" | "contrast";
	amount: number;
}) {
	if (filter.kind === "none") return "none";
	return `${filter.kind}(${filter.amount * 100}%)`;
}

async function renderFrames(
	imagePath: string,
	orientation: Orientation,
	resolution: Resolution,
	fps: FrameRate,
	onFrame: (buffer: Buffer) => Promise<void> | void,
	onProgress?: (percent: number) => void,
): Promise<void> {
	const viewport = VIEWPORTS[orientation][resolution];
	const scale = travelScale(viewport.width);
	const box = pictureBox(viewport, scale);

	const image = await loadImage(imagePath);
	const fitScale = Math.min(
		1,
		box.width / image.width,
		box.height / image.height,
	);
	const drawWidth = image.width * fitScale;
	const drawHeight = image.height * fitScale;

	const canvas = createCanvas(viewport.width, viewport.height);
	const ctx = canvas.getContext("2d");

	const totalFrames = Math.ceil((EXPORT_DURATION_MS / 1000) * fps);
	for (let n = 0; n < totalFrames; n++) {
		const frameTimeMs = (n * 1000) / fps;
		const stage = findStage(frameTimeMs);
		const elapsed = frameTimeMs - stage.startMs;

		ctx.clearRect(0, 0, viewport.width, viewport.height);

		for (let i = 0; i < pictureIds.length; i++) {
			if (!stage.pictures.includes(pictureIds[i])) continue;
			const anim = ANIMATIONS[pictureAnimationKey(stage.class, i)];
			if (!anim) continue;
			const frame = resolvePictureFrame(anim, elapsed);
			if (frame.opacity <= 0) continue;

			ctx.save();
			// base position: img is centered in the viewport (base.css's
			// inset:0 + margin:auto), then the individual `scale` CSS
			// property (--travel-scale) applies, then the keyframe's own
			// transform applies on top — travel-scale ends up multiplying
			// the keyframe's translate distances too (confirmed against the
			// comment in base.css: "scales the whole rendered transform
			// down proportionally").
			ctx.translate(viewport.width / 2, viewport.height / 2);
			ctx.scale(scale, scale);
			ctx.translate(frame.x, frame.y);
			// stars.css doesn't use one consistent transform-function order
			// across animations (see keyframes.ts's TransformOrder comment)
			// — CSS composes functions in written order, so the ctx call
			// order below must match each animation's own order, not a
			// single hardcoded sequence.
			const rotateRad = (frame.rotateDeg * Math.PI) / 180;
			if (anim.transformOrder === "scale-rotate") {
				ctx.scale(frame.scaleX, frame.scaleY);
				ctx.rotate(rotateRad);
			} else {
				ctx.rotate(rotateRad);
				ctx.scale(frame.scaleX, frame.scaleY);
			}
			ctx.filter = cssFilterString(frame.filter);
			ctx.globalAlpha = frame.opacity;
			ctx.drawImage(
				image,
				-drawWidth / 2,
				-drawHeight / 2,
				drawWidth,
				drawHeight,
			);
			ctx.restore();
		}

		await onFrame(canvas.data());
		// frames are piped into ffmpeg as they're generated (not rendered
		// up front then encoded in a second pass), so "frames sent so far"
		// tracks real encode progress closely enough — no need to parse
		// ffmpeg's own stderr progress output for this. Capped below 100
		// (not a full 0-100 scale) since ffmpeg still has to finish encoding
		// after the last frame is piped in — GIF's palettegen/paletteuse pass
		// in particular keeps running well after every frame has arrived, so
		// hitting 100% here would leave the UI stuck at "100%" for that whole
		// remaining stretch. renderExport() emits the real 100% once ffmpeg's
		// process has actually exited.
		onProgress?.(Math.round(((n + 1) / totalFrames) * FRAME_PROGRESS_CAP));
	}
}

async function runFfmpeg(
	args: string[],
	onStdin: (write: (chunk: Buffer) => Promise<void>) => Promise<void>,
) {
	const proc = Bun.spawn(["ffmpeg", ...args], {
		stdin: "pipe",
		stdout: "ignore",
		stderr: "ignore",
	});

	const write = async (chunk: Buffer) => {
		await proc.stdin.write(chunk);
	};
	await onStdin(write);
	await proc.stdin.end();

	const exitCode = await proc.exited;
	if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
}

const backgroundVideoPath = `${import.meta.dir}/../client/public/videos/background.mp4`;

// background.mp4's own AAC audio track can be copied byte-for-byte into an
// MP4 output (same container family), but WebM can't carry AAC at all —
// vorbis is the traditional, always-available WebM audio codec, so that
// format re-encodes instead of copying.
const ENCODE_ARGS: Record<"mp4" | "webm", string[]> = {
	mp4: ["-c:a", "copy", "-c:v", "libx264", "-preset", "ultrafast"],
	webm: [
		"-c:a",
		"libvorbis",
		"-c:v",
		"libvpx",
		"-deadline",
		"realtime",
		"-cpu-used",
		"8",
		"-crf",
		"30",
		"-b:v",
		"1M",
	],
};

export async function renderExport(
	imagePath: string,
	orientation: Orientation,
	resolution: Resolution,
	fps: FrameRate,
	format: ExportFormat,
	dir: string,
	onProgress?: (percent: number) => void,
): Promise<string> {
	const viewport = VIEWPORTS[orientation][resolution];
	const outPath = join(dir, `export.${format}`);

	// cover-crops the source background.mp4 (1280x720) down/up to the
	// export's viewport — for portrait this also reshapes the aspect ratio,
	// matching the CSS `min-width/min-height: 100%` "cover" sizing the
	// <video> gets in the browser; for landscape it's just a scale (16:9
	// already matches every landscape tier, so the crop is a no-op). The
	// trailing fps filter resamples the background from its own native
	// ~23.976fps up (or down) to our chosen fps *before* the overlay filter
	// runs — without it, overlay's output cadence is driven by its *main*
	// ([0:v], the background) input, so at fps=60 it would still only
	// sample our 60fps picture-overlay stream ~24 times/sec (confirmed by
	// testing: framemd5 showed heavy frame duplication, one identical frame
	// repeated 331 times, at 60fps before this fix) — the picture motion
	// itself needs the *main* input resampled to the target rate so overlay
	// actually consumes a distinct overlay frame every output frame.
	const bgFilter = `scale=${viewport.width}:${viewport.height}:force_original_aspect_ratio=increase,crop=${viewport.width}:${viewport.height},fps=${fps}`;

	// GIF has no audio track and needs a palette pass for reasonable
	// quality (ffmpeg's default GIF encoder without one looks banded/dithered
	// badly), so its filter graph/map/tail genuinely diverge from mp4/webm
	// rather than fitting the same fixed shape. paletteuse's default dither
	// (sierra2_4a, an error-diffusion algorithm) produces essentially random
	// per-frame noise that both looks worse and compresses worse than an
	// ordered (Bayer) dither for this kind of content — measured ~29%
	// smaller (25.4MB -> 18.1MB at 360p/15fps) with no visible quality
	// difference at bayer_scale=5 (the coarsest/most size-efficient setting)
	// vs the default. The full 256-color palette (palettegen's default) is
	// kept as-is — capping max_colors was tried and measured smaller but
	// caused visible banding, so it was rejected in favor of the size cut
	// below, which doesn't touch color depth at all.
	//
	// GIF_SCALE_FACTOR downscales the *composited* frame (not the canvas
	// render itself, which stays at the full chosen resolution) right before
	// the palette/gif encode stage — this trims pixel count (the dominant
	// cost driver for GIF size, more so than frame count: mpdecimate-style
	// duplicate-frame dropping was measured to barely move file size at all)
	// without reducing color count or introducing dithering artifacts.
	// Rendering at full resolution and downscaling afterwards also looks
	// better than natively rendering smaller would (closer to supersampling)
	// — confirmed by pixel-comparing extracted frames: no visible banding at
	// any factor tested down to 0.45. 0.5 (an even half-resolution downscale,
	// e.g. 640x360 -> 320x180) was measured at ~8.2MB at 360p/24fps (GIF's
	// max framerate, the worst case for size) and ~5MB at 360p/15fps —
	// comfortably inside a 5-8MB target across GIF's whole fps range.
	const GIF_SCALE_FACTOR = 0.5;
	const filterComplex =
		format === "gif"
			? `[0:v]${bgFilter}[bg];[bg][1:v]overlay=shortest=1[comp];[comp]scale=iw*${GIF_SCALE_FACTOR}:ih*${GIF_SCALE_FACTOR}[small];[small]split[a][b];[a]palettegen[pal];[b][pal]paletteuse=dither=bayer:bayer_scale=5[out]`
			: `[0:v]${bgFilter}[bg];[bg][1:v]overlay=shortest=1[comp]`;

	const mapArgs =
		format === "gif" ? ["-map", "[out]"] : ["-map", "[comp]", "-map", "0:a?"];

	// forces the actual encoded output to our chosen fps — without this,
	// the muxer just inherits the filter graph's natural framerate (the
	// *main* input to the overlay filter, i.e. background.mp4's own native
	// ~23.976fps), silently ignoring whatever fps the rawvideo input above
	// was piped at. Confirmed by testing: omitting this made every fps
	// choice other than 24 (background.mp4's own rate, rounded) have no
	// visible effect at all.
	const outputFpsArgs = ["-r", `${fps}`];

	// "-shortest"/"-pix_fmt yuv420p" only make sense for the audio-bearing,
	// yuv-encoded video formats — gif has neither an audio track to trim nor
	// a yuv pixel format, and ffmpeg picks the gif muxer from outPath's
	// extension on its own, same as it already does for mp4/webm
	const tailArgs =
		format === "gif"
			? []
			: [...ENCODE_ARGS[format], "-shortest", "-pix_fmt", "yuv420p"];

	await runFfmpeg(
		[
			"-i",
			backgroundVideoPath,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"-s",
			`${viewport.width}x${viewport.height}`,
			"-r",
			`${fps}`,
			"-i",
			"pipe:0",
			"-filter_complex",
			filterComplex,
			...mapArgs,
			...outputFpsArgs,
			...tailArgs,
			"-y",
			outPath,
		],
		async (write) => {
			await renderFrames(
				imagePath,
				orientation,
				resolution,
				fps,
				write,
				onProgress,
			);
		},
	);

	// the frame-loop progress above tops out at FRAME_PROGRESS_CAP, not 100 —
	// this is the real 100%, only reported once ffmpeg has actually finished
	// (encoding/palette work can run well after the last frame was piped in)
	onProgress?.(100);

	return outPath;
}

export type ExportJob = {
	imagePath: string;
	orientation: Orientation;
	resolution: Resolution;
	fps: FrameRate;
	format: ExportFormat;
	dir: string;
};

type WorkerMessage =
	| { type: "progress"; percent: number }
	| { type: "done"; outputPath: string }
	| { type: "error"; message: string };

// runs renderExport() on a separate OS thread (server/export-worker.ts)
// instead of directly on Bun.serve's own thread. @napi-rs/canvas's per-frame
// drawing is synchronous native CPU work — the ffmpeg subprocess was already
// off-thread via Bun.spawn, but without this, the *canvas* half of a render
// would still block the server from handling any other request (page loads,
// uploads, other exports' progress polls) for the whole render duration.
export function renderExportInWorker(
	job: ExportJob,
	onProgress?: (percent: number) => void,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(`${import.meta.dir}/export-worker.ts`, {
			workerData: job,
		});

		// export-worker.ts has nothing left to do once it posts "done"/
		// "error", so its own script simply runs to completion and the
		// thread exits on its own — forcibly worker.terminate()-ing it from
		// here raced that natural exit and left Bun warning "ObjectRef is
		// not unref" on every export
		worker.on("message", (msg: WorkerMessage) => {
			if (msg.type === "progress") {
				onProgress?.(msg.percent);
			} else if (msg.type === "done") {
				resolve(msg.outputPath);
			} else {
				reject(new Error(msg.message));
			}
		});
		worker.on("error", reject);
	});
}
