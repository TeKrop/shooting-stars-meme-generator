// Export option types/constants/logic shared between client/export.ts (the
// pre-export options dialog) and server/export.ts (the renderer + query-param
// validation) — lives in client/ and is imported across the boundary by
// server/export.ts, the same way client/animation-timeline.ts already is.
// Kept dependency-free (no DOM, no Node/Bun APIs) so it's safe both bundled
// into the browser and run directly under Bun on the server. Centralized
// here (rather than duplicated in both files) so the GIF caps/ordering and
// the clamping logic itself can't drift out of sync between client and
// server the way hand-copied constants eventually would.

export type Orientation = "landscape" | "portrait";
// 720p is the max tier: background.mp4 itself is authored at 1280x720, so a
// 1080p export would just be upscaling the background for no real gain
export type Resolution = "360p" | "480p" | "720p";
export type FrameRate = 15 | 24 | 60;
export type ExportFormat = "mp4" | "webm" | "gif";

export const RESOLUTION_ORDER: Resolution[] = ["360p", "480p", "720p"];

// GIF's palette-generation pass plus GIF's inherently poor compression for
// video-like content make high resolution/framerate impractically slow and
// huge: measured at ~146s/~324MB for 1080p/60fps, vs ~20s/~6MB for the same
// settings as WebM. 720p is excluded entirely, but 360p/480p are both
// allowed at full (unscaled) resolution — the client warns with a real size
// estimate instead of the server silently capping resolution further.
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

// leaves room for ffmpeg's own post-last-frame encoding work (GIF's
// palettegen/paletteuse pass especially) before jumping to a real 100% —
// server/export.ts's renderFrames() caps per-frame progress here instead of
// 100, then reports the real 100 once ffmpeg's process has actually exited;
// client/export.ts's progress label swaps to "Finalizing…" in that gap
// instead of sitting on a frozen percentage that reads as stuck/broken
export const FRAME_PROGRESS_CAP = 95;
