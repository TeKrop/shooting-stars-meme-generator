// The volume control of the background video, in the persistent
// #quick-actions dock.

import { getVideoElement } from "./animation";

const MUTED_ICON = "🔇";
const UNMUTED_ICON = "🔊";

export function initVolumeControl() {
	const video = getVideoElement();

	const volumeGroup = document.getElementById("volume-group") as HTMLElement;
	const volumeBtn = document.getElementById("volume-btn") as HTMLButtonElement;
	const volumeMenu = document.getElementById("volume-menu") as HTMLElement;
	const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement;
	const volumeSlider = document.getElementById(
		"volume-slider",
	) as HTMLInputElement;

	// Reads the default that animation.ts set. A second default here could
	// drift away from that value.
	volumeSlider.value = String(Math.round(video.volume * 100));

	function setMenuOpen(open: boolean) {
		volumeMenu.hidden = !open;
		volumeBtn.setAttribute("aria-expanded", String(open));
	}

	// A volume of 0 plays silently. The .muted flag does the same. Either
	// one alone therefore reads as "muted" in the user interface.
	function isMuted(): boolean {
		return video.muted || video.volume === 0;
	}

	function updateMuteUI() {
		const muted = isMuted();
		const icon = muted ? MUTED_ICON : UNMUTED_ICON;
		volumeBtn.textContent = icon;
		muteBtn.textContent = icon;
		muteBtn.setAttribute("aria-pressed", String(muted));
		muteBtn.title = muted ? "Unmute" : "Mute";
		muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
	}

	volumeBtn.addEventListener("click", () => {
		setMenuOpen(!!volumeMenu.hidden);
	});

	// Closes the popover on a click outside the group, as export.ts does.
	document.addEventListener("click", (e) => {
		if (!volumeGroup.contains(e.target as Node)) setMenuOpen(false);
	});

	// Escape closes the popover from any focused element inside it, so a
	// keyboard user gets what an outside click gives a mouse user.
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !volumeMenu.hidden) setMenuOpen(false);
	});

	muteBtn.addEventListener("click", () => {
		video.muted = !video.muted;
		updateMuteUI();
	});

	// A drag always means "I want sound", as a native media player does. It
	// unmutes even at 0, which isMuted() then reads as muted again.
	volumeSlider.addEventListener("input", () => {
		video.volume = Number(volumeSlider.value) / 100;
		video.muted = false;
		updateMuteUI();
	});

	updateMuteUI();
}
