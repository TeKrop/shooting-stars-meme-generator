// the shooting-stars choreography engine: launch prompt + the timed
// picture/video sequence itself

import { ANIMATION_TIMELINE, pictureAnimationKey } from "./animation-timeline";

const video = document.getElementById("video") as HTMLVideoElement;
// set video volume to 5%
video.volume = 0.05;
// once the video has ended, restart the animation
video.addEventListener("ended", restartAnimation, false);

const landing = document.getElementById("landing") as HTMLElement;
const starfield = document.getElementById("starfield") as HTMLElement;
const tapToPlay = document.getElementById("tap-to-play") as HTMLElement;
const tapToPlayText =
	'<span class="spark">✦</span> Press to fly <span class="spark">✦</span>';

// pending setTimeout ids for the current run's picture choreography, so a
// restart (e.g. uploading a new image mid-flight) can cancel them instead
// of leaving them to fire later and stomp on the new run's classes
let animationTimeouts: ReturnType<typeof setTimeout>[] = [];

// how long to wait for the video's `playing` event before starting the
// picture choreography anyway — covers stalled buffering, a decode error,
// or a play() rejection, any of which would otherwise never fire `playing`
// and leave the choreography stuck waiting forever
const PLAYING_FALLBACK_MS = 1000;

// the current run's pending "start the choreography" trigger (either the
// video's `playing` event or the fallback timeout above, whichever fires
// first) — tracked so a restart before either has fired can cancel them,
// instead of leaving a stale one to double-schedule alongside the new run's
let pendingTimelineStart: (() => void) | null = null;
let pendingTimelineFallback: ReturnType<typeof setTimeout> | null = null;

// showLaunchPrompt() re-runs on every restart (video 'ended', or a fresh
// upload) — this guards against re-attaching the click/touchend listeners
// each time, which would otherwise fire startAnimation multiple times per
// tap. Can't just attach them once unconditionally at module load instead:
// they're deliberately gated behind the video being ready (see below).
let launchListenersAttached = false;

/**
 * Restart the event (automatic if desktop, manually if mobile)
 */
export function restartAnimation() {
	video.style.display = "none";
	showLaunchPrompt();
}

/**
 * Don't allow launching until the video is actually loaded, so the
 * animation can never run ahead of a video that isn't ready yet
 */
function showLaunchPrompt() {
	landing.style.display = "flex";
	landing.classList.remove("fade-out");
	starfield.classList.remove("fade-out");
	if (video.readyState >= video.HAVE_CURRENT_DATA) {
		tapToPlay.innerHTML = `<p>${tapToPlayText}</p>`;
		// scoped to the prompt itself, not the whole page — only clicking/
		// tapping this specific element launches the animation (being a
		// real <button> also gets Enter/Space handling for free)
		if (!launchListenersAttached) {
			tapToPlay.addEventListener("touchend", (event) => {
				// without this, the synthetic click that follows a touch
				// tap would call startAnimation() a second time
				event.preventDefault();
				startAnimation();
			});
			tapToPlay.addEventListener("click", startAnimation);
			launchListenersAttached = true;
		}
	} else {
		tapToPlay.innerHTML = "<p>⌛ Loading…</p>";
		video.addEventListener("loadeddata", showLaunchPrompt, {
			once: true,
		});
	}
}

// pictures classes
const pictures = ["pict1", "pict2", "pict3", "pict4", "pict5", "pict6"];

/**
 * Start the shooting stars animation — always (re)starts cleanly, so
 * calling it while a run is already ongoing (e.g. uploading a new image
 * mid-flight) restarts from "init" with the new image instead of just
 * swapping the picture src underneath whatever's currently flying.
 */
export function startAnimation() {
	// cancel any still-pending choreography from a previous run so it can't
	// fire later and stomp on this run's classes
	animationTimeouts.forEach((id) => {
		clearTimeout(id);
	});
	animationTimeouts = [];

	// cancel any still-pending choreography trigger from a previous run, so
	// it can't fire later and double-schedule alongside this run's
	if (pendingTimelineStart) {
		video.removeEventListener("playing", pendingTimelineStart);
	}
	if (pendingTimelineFallback !== null) {
		clearTimeout(pendingTimelineFallback);
	}

	// fades out rather than vanishing instantly, so the console visibly
	// hands off to the image that flies in during the "init" stage below
	landing.classList.add("fade-out");
	starfield.classList.add("fade-out");
	video.style.display = "block";

	const startTimelineOnce = () => {
		video.removeEventListener("playing", startTimelineOnce);
		if (pendingTimelineFallback !== null) {
			clearTimeout(pendingTimelineFallback);
		}
		pendingTimelineStart = null;
		pendingTimelineFallback = null;
		scheduleTimeline();
	};
	pendingTimelineStart = startTimelineOnce;

	// don't schedule the picture choreography until the video has actually
	// started rendering frames — on mobile, play()-call-to-first-frame
	// latency is high enough that scheduling immediately (as before) makes
	// the pictures visibly get ahead of the video. The fallback timeout
	// covers the case where `playing` never fires at all (see
	// PLAYING_FALLBACK_MS above).
	video.addEventListener("playing", startTimelineOnce, { once: true });
	pendingTimelineFallback = setTimeout(startTimelineOnce, PLAYING_FALLBACK_MS);

	// play the background video from the start, even if a previous run
	// left it mid-playback
	video.currentTime = 0;
	video.play().catch(() => {
		// autoplay blocked or playback otherwise failed to start — the
		// fallback timeout above still kicks off the choreography so it
		// isn't left stuck waiting for a video that will never play
	});
}

function scheduleTimeline() {
	// main loop for class change events
	for (const time in ANIMATION_TIMELINE) {
		const id = setTimeout(() => {
			// foreach pictures
			for (let i = pictures.length - 1; i >= 0; i--) {
				const img = document.getElementById(pictures[i]) as HTMLElement;
				// if the picture is in the current animation array, add the correct class
				if (
					ANIMATION_TIMELINE[Number(time)].pictures.indexOf(pictures[i]) > -1
				) {
					img.className = pictureAnimationKey(
						ANIMATION_TIMELINE[Number(time)].class,
						i,
					);
				} else {
					// else, hide the picture
					img.className = "hide";
				}
			}
		}, Number(time));
		animationTimeouts.push(id);
	}
}
