// Server-side animation export, without a headless browser: renders
// transparent RGBA frames with a native canvas (replicating stars.css's
// keyframes + animation.ts's stage timeline — see server/keyframes.ts) and
// pipes them into a single ffmpeg process that composites them over
// background.mp4 and encodes the result. This is why it can be near-instant
// where the old (abandoned) approach — recording the real page with
// Playwright — took ~20-27s per export: there's no real-time playback or
// browser to wait on, just compositing + a fast software encode.

import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ANIMATION_TIMELINE } from "../client/animation-timeline";
import { ANIMATIONS, resolvePictureFrame } from "./keyframes";

export type Orientation = "landscape" | "portrait";
export type ExportFormat = "mp4" | "webm";

// 480p — smaller than the source background.mp4 (1280x720), traded for
// faster encodes; bgFilter below scales the source down to match regardless
// of orientation, not just when cropping portrait
const VIEWPORTS: Record<Orientation, { width: number; height: number }> = {
	landscape: { width: 854, height: 480 },
	portrait: { width: 480, height: 854 },
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

const FPS = 24;

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
	onFrame: (buffer: Buffer) => Promise<void> | void,
	onProgress?: (percent: number) => void,
): Promise<void> {
	const viewport = VIEWPORTS[orientation];
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

	const totalFrames = Math.ceil((EXPORT_DURATION_MS / 1000) * FPS);
	for (let n = 0; n < totalFrames; n++) {
		const frameTimeMs = (n * 1000) / FPS;
		const stage = findStage(frameTimeMs);
		const elapsed = frameTimeMs - stage.startMs;

		ctx.clearRect(0, 0, viewport.width, viewport.height);

		for (let i = 0; i < pictureIds.length; i++) {
			if (!stage.pictures.includes(pictureIds[i])) continue;
			const anim = ANIMATIONS[`${stage.class}_${i + 1}`];
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
		// ffmpeg's own stderr progress output for this
		onProgress?.(Math.round(((n + 1) / totalFrames) * 100));
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
const ENCODE_ARGS: Record<string, string[]> = {
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
	format: ExportFormat,
	dir: string,
	onProgress?: (percent: number) => void,
): Promise<string> {
	const viewport = VIEWPORTS[orientation];
	const outPath = join(dir, `export.${format}`);

	// cover-crops the source background.mp4 (1280x720) down to the export's
	// viewport — for portrait this also reshapes the aspect ratio, matching
	// the CSS `min-width/min-height: 100%` "cover" sizing the <video> gets
	// in the browser; for landscape it's just a downscale to 480p (16:9
	// already matches, so the crop is a no-op)
	const bgFilter = `scale=${viewport.width}:${viewport.height}:force_original_aspect_ratio=increase,crop=${viewport.width}:${viewport.height}`;

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
			`${FPS}`,
			"-i",
			"pipe:0",
			"-filter_complex",
			`[0:v]${bgFilter}[bg];[bg][1:v]overlay=shortest=1[comp]`,
			"-map",
			"[comp]",
			// "-shortest" trims the (possibly re-encoded) audio track to match
			// the rendered video length so it doesn't play on past the last frame
			"-map",
			"0:a?",
			...ENCODE_ARGS[format],
			"-shortest",
			"-pix_fmt",
			"yuv420p",
			"-y",
			outPath,
		],
		async (write) => {
			await renderFrames(imagePath, orientation, write, onProgress);
		},
	);

	return outPath;
}
