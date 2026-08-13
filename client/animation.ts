// The shooting-stars choreography engine. It holds the launch prompt. It
// also holds the timed picture sequence and video sequence.

import { ANIMATION_TIMELINE, pictureAnimationKey } from "./animation-timeline";

const video = document.getElementById("video") as HTMLVideoElement;
video.volume = 0.05;
video.addEventListener("ended", restartAnimation, false);

/**
 * Lets other modules read and change playback properties such as .volume,
 * without each one taking its own `getElementById("video")` reference.
 * Only volume.ts uses it now.
 */
export function getVideoElement(): HTMLVideoElement {
	return video;
}

const landing = document.getElementById("landing") as HTMLElement;
const starfield = document.getElementById("starfield") as HTMLElement;
const tapToPlay = document.getElementById("tap-to-play") as HTMLElement;
const tapToPlayText =
	'<span class="spark">✦</span> Press to fly <span class="spark">✦</span>';

// The pending setTimeout ids of the choreography of this run. A restart
// cancels them, so a stale timeout cannot overwrite the new run's classes.
let animationTimeouts: ReturnType<typeof setTimeout>[] = [];

// How long to wait for the `playing` event before starting anyway. Stalled
// buffering, a decode error, or a rejected play() call each hold it back
// forever.
const PLAYING_FALLBACK_MS = 1000;

// The pending start trigger of this run: the `playing` event or the fallback
// timeout above, whichever comes first. Tracked so a restart can cancel both
// before a stale one schedules a second choreography.
let pendingTimelineStart: (() => void) | null = null;
let pendingTimelineFallback: ReturnType<typeof setTimeout> | null = null;

// showLaunchPrompt() runs again on every restart, so this flag stops a
// second listener attachment that would fire startAnimation twice per tap.
// A single attachment at module load cannot work: the listeners wait on the
// ready state of the video.
let launchListenersAttached = false;

/**
 * Restarts the event. A desktop browser does this automatically. A mobile
 * browser needs a tap from the user.
 */
export function restartAnimation() {
	video.style.display = "none";
	showLaunchPrompt();
}

/**
 * Blocks the launch until the video loads. The animation can therefore never
 * run ahead of a video that is not ready.
 */
function showLaunchPrompt() {
	landing.style.display = "flex";
	landing.classList.remove("fade-out");
	starfield.classList.remove("fade-out");
	if (video.readyState >= video.HAVE_CURRENT_DATA) {
		tapToPlay.innerHTML = `<p>${tapToPlayText}</p>`;
		// Scoped to the prompt, not the page: only this element launches
		// the animation. It is a real <button>, so Enter and Space work.
		if (!launchListenersAttached) {
			tapToPlay.addEventListener("touchend", (event) => {
				// A touch tap also sends a synthetic click event. This
				// call stops a second startAnimation() call.
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

// The picture classes.
const pictures = ["pict1", "pict2", "pict3", "pict4", "pict5", "pict6"];

/**
 * Starts the shooting stars animation, always cleanly. A call during a run
 * restarts from "init" with the new image, rather than swapping the source
 * under whatever is currently flying.
 */
export function startAnimation() {
	// Cancels the pending choreography of an earlier run. Those timeouts
	// would otherwise fire later and overwrite the classes of this run.
	animationTimeouts.forEach((id) => {
		clearTimeout(id);
	});
	animationTimeouts = [];

	// Cancels the pending start trigger of an earlier run. It would
	// otherwise schedule a second choreography next to this one.
	if (pendingTimelineStart) {
		video.removeEventListener("playing", pendingTimelineStart);
	}
	if (pendingTimelineFallback !== null) {
		clearTimeout(pendingTimelineFallback);
	}

	// Fades out instead of disappearing at once. The console therefore
	// hands off visibly to the image of the "init" stage below.
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

	// Waits for the first rendered frame before scheduling the choreography.
	// A mobile browser is slow between play() and that frame, so an immediate
	// schedule puts the pictures visibly ahead of the video.
	video.addEventListener("playing", startTimelineOnce, { once: true });
	pendingTimelineFallback = setTimeout(startTimelineOnce, PLAYING_FALLBACK_MS);

	// Plays the background video from the start. An earlier run can leave
	// it part way through.
	video.currentTime = 0;
	video.play().catch(() => {
		// The browser blocked autoplay, or playback failed to start. The
		// fallback timeout above still starts the choreography. It
		// therefore never waits on a video that will not play.
	});
}

function scheduleTimeline() {
	for (const time in ANIMATION_TIMELINE) {
		const stage = ANIMATION_TIMELINE[Number(time)];
		const id = setTimeout(() => {
			for (let i = pictures.length - 1; i >= 0; i--) {
				const img = document.getElementById(pictures[i]) as HTMLElement;
				if (stage.pictures.indexOf(pictures[i]) > -1) {
					img.className = pictureAnimationKey(stage.class, i);
				} else {
					img.className = "hide";
				}
			}
		}, Number(time));
		animationTimeouts.push(id);
	}
}
