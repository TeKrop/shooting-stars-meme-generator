// Animation export on the server, without a headless browser. A native
// canvas renders transparent RGBA frames from server/keyframes.ts. One
// ffmpeg process composites them over background.mp4 and encodes the result.
// The old Playwright approach recorded the real page and needed 20 to 27
// seconds. This one waits on no real-time playback.

import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
	ANIMATION_TIMELINE,
	pictureAnimationKey,
} from "../client/animation-timeline";
// The `export *` below re-exports these names, so the `from "./export"`
// imports in server.ts and export-worker.ts need no change. This file stays
// the single import point for the export code of the server.
import {
	type ExportFormat,
	FRAME_PROGRESS_CAP,
	type FrameRate,
	type Orientation,
	type Resolution,
} from "../client/export-options";
import { ANIMATIONS, resolvePictureFrame } from "./keyframes";

export * from "../client/export-options";

export const RESOLUTIONS: Resolution[] = ["360p", "480p", "720p"];
export const FRAME_RATES: FrameRate[] = [15, 24, 60];
export const EXPORT_FORMATS: ExportFormat[] = ["mp4", "webm", "gif"];

export const DEFAULT_RESOLUTION: Resolution = "480p";
export const DEFAULT_FPS: FrameRate = 24;
export const DEFAULT_FORMAT: ExportFormat = "mp4";

// 480p is the original default tier, kept so old shared exports still behave
// the same way. Every tier matches the viewport aspect ratio: 16:9 landscape,
// 9:16 portrait. The background filter below scales and crops to match.
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

// Matches `--travel-scale: clamp(0.25, calc(100vw / 1400px), 1)` in base.css.
// The code computes it once per orientation. The export viewport has a fixed
// size. It never resizes during a render.
function travelScale(viewportWidth: number): number {
	return Math.min(1, Math.max(0.25, viewportWidth / 1400));
}

// Matches `img { max-width: calc(30% / var(--travel-scale)) }` in base.css.
// The max-height rule uses the same formula against the viewport height.
// An upload fits into this box before the keyframe transform applies.
function pictureBox(
	viewport: { width: number; height: number },
	scale: number,
) {
	return {
		width: (viewport.width * 0.3) / scale,
		height: (viewport.height * 0.3) / scale,
	};
}

// The last ANIMATION_TIMELINE offset is the loop point. The stage returns to
// "init" there. That offset matches the length of the background video.
const EXPORT_DURATION_MS = Math.max(
	...Object.keys(ANIMATION_TIMELINE).map(Number),
);

const pictureIds = ["pict1", "pict2", "pict3", "pict4", "pict5", "pict6"];

// Sorted upward, so findStage can scan linearly. It takes the last entry
// that starts at or before the current frame time. The list holds 8 entries.
// A faster search gains nothing here.
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

	function drawFrame(frameTimeMs: number) {
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
			// Base position: base.css centers the image, then --travel-scale
			// applies, then the keyframe transform. travel-scale therefore
			// also multiplies the keyframe translate distances.
			ctx.translate(viewport.width / 2, viewport.height / 2);
			ctx.scale(scale, scale);
			ctx.translate(frame.x, frame.y);
			// stars.css uses no single transform function order across the
			// animations. See the TransformOrder comment in keyframes.ts.
			// CSS composes these functions in written order. The ctx calls
			// below must therefore follow the order of each animation.
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
	}

	const totalFrames = Math.ceil((EXPORT_DURATION_MS / 1000) * fps);
	for (let n = 0; n < totalFrames; n++) {
		const frameTimeMs = (n * 1000) / fps;
		drawFrame(frameTimeMs);

		await onFrame(canvas.data());
		// Frames go into ffmpeg as they render, so the sent count tracks
		// encode progress closely enough to parse no stderr output.
		// The scale stops below 100 because ffmpeg keeps encoding after the
		// last frame. renderExport() reports the real 100 once it exits.
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

// An MP4 output can copy the AAC audio track of background.mp4 byte for
// byte. Both files use the same container family. WebM cannot carry AAC at
// all. Vorbis is the traditional WebM audio codec. It is always available.
// The WebM path therefore re-encodes the audio.
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

type FfmpegFilterStep = {
	filter: string;
	args?: Record<string, string | number>;
};

type FfmpegFilterChain = {
	inputs?: string[];
	steps: FfmpegFilterStep[];
	outputs?: string[];
};

function renderFilterChain(chain: FfmpegFilterChain): string {
	const inputs = (chain.inputs ?? []).map((label) => `[${label}]`).join("");
	const outputs = (chain.outputs ?? []).map((label) => `[${label}]`).join("");
	const steps = chain.steps
		.map(({ filter, args }) => {
			if (!args || Object.keys(args).length === 0) return filter;
			const params = Object.entries(args)
				.map(([key, value]) => `${key}=${value}`)
				.join(":");
			return `${filter}=${params}`;
		})
		.join(",");
	return `${inputs}${steps}${outputs}`;
}

function renderFilterComplex(chains: FfmpegFilterChain[]): string {
	return chains.map(renderFilterChain).join(";");
}

function buildFilterComplex(
	viewport: { width: number; height: number },
	fps: FrameRate,
	format: ExportFormat,
): string {
	// Crops background.mp4 (1280x720) to the viewport, like CSS `cover`. The
	// portrait path also reshapes the aspect ratio.
	// The trailing fps filter must run before overlay. The *main* input
	// ([0:v]) otherwise drives the output cadence, and overlay samples the
	// picture stream at about 24fps whatever the user picked.
	const bg: FfmpegFilterChain = {
		inputs: ["0:v"],
		steps: [
			{
				filter: "scale",
				args: {
					w: viewport.width,
					h: viewport.height,
					force_original_aspect_ratio: "increase",
				},
			},
			{ filter: "crop", args: { w: viewport.width, h: viewport.height } },
			{ filter: "fps", args: { fps } },
		],
		outputs: ["bg"],
	};
	const overlay: FfmpegFilterChain = {
		inputs: ["bg", "1:v"],
		steps: [{ filter: "overlay", args: { shortest: 1 } }],
		outputs: ["comp"],
	};

	if (format !== "gif") return renderFilterComplex([bg, overlay]);

	// GIF carries no audio and needs a palette pass, so its graph diverges
	// from the video formats. The Bayer dither measured about 29% smaller
	// than the sierra2_4a default, with no visible quality loss.
	// The palette keeps all 256 colors. This code applies no downscale; the
	// client shows a size estimate instead. See CLAUDE.md.
	return renderFilterComplex([
		bg,
		overlay,
		{ inputs: ["comp"], steps: [{ filter: "split" }], outputs: ["a", "b"] },
		{ inputs: ["a"], steps: [{ filter: "palettegen" }], outputs: ["pal"] },
		{
			inputs: ["b", "pal"],
			steps: [
				{ filter: "paletteuse", args: { dither: "bayer", bayer_scale: 5 } },
			],
			outputs: ["out"],
		},
	]);
}

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

	const filterComplex = buildFilterComplex(viewport, fps, format);

	const mapArgs =
		format === "gif" ? ["-map", "[out]"] : ["-map", "[comp]", "-map", "0:a?"];

	// Forces the encoded output to the selected fps. The muxer otherwise
	// inherits the rate of the filter graph, about 23.976fps, and ignores the
	// rawvideo input above. Every fps choice except 24 then did nothing.
	const outputFpsArgs = ["-r", `${fps}`];

	// "-shortest" and "-pix_fmt yuv420p" suit the video formats that carry
	// audio and use YUV. GIF has no audio track to trim. GIF has no YUV pixel
	// format either. ffmpeg selects the GIF muxer from the extension of
	// outPath, as it already does for MP4 and WebM.
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

	// The frame loop above stops at FRAME_PROGRESS_CAP, not at 100. This call
	// reports the real 100, after ffmpeg finishes. The encode work and the
	// palette work can run long after the last frame reaches the pipe.
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

// Runs renderExport() on a separate OS thread (server/export-worker.ts). The
// per-frame drawing of @napi-rs/canvas is synchronous native CPU work, so it
// would otherwise block every other request for the whole render.
export function renderExportInWorker(
	job: ExportJob,
	onProgress?: (percent: number) => void,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(`${import.meta.dir}/export-worker.ts`, {
			workerData: job,
		});

		// export-worker.ts has no work left after it posts a result, so the
		// thread exits by itself. A forced worker.terminate() raced that
		// exit and made Bun warn "ObjectRef is not unref" on every export.
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

// One name groups these pure helpers, so the real public API of the module
// stays visible on its own. They appear here only so tests/keyframes.test.ts
// can call them directly, instead of through a full render.
export const testInternals = {
	travelScale,
	pictureBox,
	findStage,
	cssFilterString,
	renderFilterChain,
	renderFilterComplex,
	buildFilterComplex,
};
