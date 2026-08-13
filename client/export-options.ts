// The export option types, constants, and logic, shared by the options
// dialog in client/export.ts and the renderer in server/export.ts, which
// imports this file across the boundary.
//
// It has no dependency, no DOM access, and no Bun or Node call, so it is safe
// in the browser bundle and under Bun.

export type Orientation = "landscape" | "portrait";
// 720p is the highest tier. background.mp4 itself is 1280x720. A 1080p
// export would only upscale the background, for no real gain.
export type Resolution = "360p" | "480p" | "720p";
export type FrameRate = 15 | 24 | 60;
export type ExportFormat = "mp4" | "webm" | "gif";

export const RESOLUTION_ORDER: Resolution[] = ["360p", "480p", "720p"];

// GIF needs a palette pass and compresses video-like content poorly, so a
// high resolution or frame rate becomes slow and very large: 1080p60
// measured about 146s and 324MB, against about 20s and 6MB as WebM.
// These caps exclude 720p. 360p and 480p run at full resolution, with a real
// size estimate in the client instead of a further silent cap.
export const GIF_MAX_RESOLUTION: Resolution = "480p";
export const GIF_MAX_FPS: FrameRate = 24;

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

// Leaves room for the ffmpeg encode work after the last frame, which the GIF
// palette passes dominate. renderFrames() stops here and reports the real 100
// once ffmpeg exits; client/export.ts shows "Finalizing…" in that gap.
export const FRAME_PROGRESS_CAP = 95;
