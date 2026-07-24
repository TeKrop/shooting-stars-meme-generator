// Pure data, no DOM access — split out of animation.ts so server/export.ts
// can import the choreography table without pulling in animation.ts's
// top-level `document.getElementById(...)` calls (which throw outside a
// browser, e.g. under `bun test`).

export type AnimationStage = {
	class: string;
	pictures: string[];
};

// the choreography table: millisecond offsets (from startAnimation()) to
// which stage class applies and which pictN ids are visible at that point.
// Shared with the server-side export renderer (server/export.ts) so both
// drive the exact same timeline instead of keeping separate copies — this
// must still stay in sync with stars.css's keyframe durations by hand (see
// CLAUDE.md), but at least the timeline itself now has one source of truth.
export const ANIMATION_TIMELINE: Record<number, AnimationStage> = {
	0: {
		class: "init",
		pictures: [],
	},
	3900: {
		class: "spaceone",
		pictures: ["pict1"],
	},
	7700: {
		class: "dolphins",
		pictures: ["pict1", "pict2"],
	},
	11600: {
		class: "spacetwo",
		pictures: ["pict1", "pict2", "pict3", "pict4", "pict5", "pict6"],
	},
	15500: {
		class: "dark",
		pictures: [],
	},
	17100: {
		class: "microone",
		pictures: ["pict1"],
	},
	19300: {
		class: "microtwo",
		pictures: ["pict1"],
	},
	24800: {
		class: "init",
		pictures: [],
	},
};
