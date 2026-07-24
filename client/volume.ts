// background-video volume control that lives in the persistent
// #quick-actions dock — see export.ts for the popover pattern this mirrors

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

	// reflect whatever animation.ts actually set as the default rather than
	// hardcoding a second default here that could drift out of sync
	volumeSlider.value = String(Math.round(video.volume * 100));

	function setMenuOpen(open: boolean) {
		volumeMenu.hidden = !open;
		volumeBtn.setAttribute("aria-expanded", String(open));
	}

	// volume 0 and .muted both play silently, so either one should read as
	// "muted" in the UI even if only one of them is technically true
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

	// closes the popover on any click outside the group, same as export.ts
	document.addEventListener("click", (e) => {
		if (!volumeGroup.contains(e.target as Node)) setMenuOpen(false);
	});

	// Escape closes the popover regardless of which element inside it is
	// focused, so keyboard users get the same dismissal outside-click gives
	// mouse users
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !volumeMenu.hidden) setMenuOpen(false);
	});

	muteBtn.addEventListener("click", () => {
		video.muted = !video.muted;
		updateMuteUI();
	});

	// dragging the slider always implies "I want sound", matching native
	// media-player convention (un-mutes even if dragged back down to 0,
	// which then just reads as muted again via isMuted()'s volume===0 check)
	volumeSlider.addEventListener("input", () => {
		video.volume = Number(volumeSlider.value) / 100;
		video.muted = false;
		updateMuteUI();
	});

	updateMuteUI();
}
