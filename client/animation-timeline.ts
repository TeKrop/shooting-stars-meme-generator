// Pure data, no DOM access — split out of animation.ts so server/export.ts
// can import the choreography table without pulling in animation.ts's
// top-level `document.getElementById(...)` calls (which throw outside a
// browser, e.g. under `bun test`).

export type AnimationStage = {
	class: string;
	pictures: string[];
};

// Authored as relative gaps (ms since the previous stage started) rather
// than absolute cumulative offsets, so retiming one stage doesn't require
// hand-recomputing every later stage's key — ANIMATION_TIMELINE below is
// derived from this at module load. gapMs has NO derived relationship to
// server/keyframes.ts's per-animation durationMs or to stars.css's keyframe
// durations (see CLAUDE.md): stages are staggered entrances, not
// back-to-back full loops, so a stage's own animation duration isn't the
// same thing as its gap to the next stage. These are still independently,
// manually chosen and must stay in sync with stars.css and
// background.mp4's runtime by hand.
type StageDef = AnimationStage & {
	gapMs: number;
};

const STAGE_DEFS: StageDef[] = [
	{ class: "init", gapMs: 0, pictures: [] },
	{ class: "spaceone", gapMs: 3900, pictures: ["pict1"] },
	{ class: "dolphins", gapMs: 3800, pictures: ["pict1", "pict2"] },
	{
		class: "spacetwo",
		gapMs: 3900,
		pictures: ["pict1", "pict2", "pict3", "pict4", "pict5", "pict6"],
	},
	{ class: "dark", gapMs: 3900, pictures: [] },
	{ class: "microone", gapMs: 1600, pictures: ["pict1"] },
	{ class: "microtwo", gapMs: 2200, pictures: ["pict1"] },
	{ class: "init", gapMs: 5500, pictures: [] },
];

function buildTimeline(defs: StageDef[]): Record<number, AnimationStage> {
	const table: Record<number, AnimationStage> = {};
	let cumulativeMs = 0;
	for (const { class: stageClass, gapMs, pictures } of defs) {
		cumulativeMs += gapMs;
		table[cumulativeMs] = { class: stageClass, pictures };
	}
	return table;
}

// the choreography table: millisecond offsets (from startAnimation()) to
// which stage class applies and which pictN ids are visible at that point.
// Shared with the server-side export renderer (server/export.ts) so both
// drive the exact same timeline instead of keeping separate copies — this
// must still stay in sync with stars.css's keyframe durations by hand (see
// CLAUDE.md), but at least the timeline itself now has one source of truth.
export const ANIMATION_TIMELINE: Record<number, AnimationStage> =
	buildTimeline(STAGE_DEFS);

// the `${stageClass}_${pictureIndex + 1}` convention used to key both
// ANIMATIONS (server/keyframes.ts) and stars.css's class selectors —
// centralized here (rather than duplicated in client/animation.ts and
// server/export.ts) so a typo/renumbering in one call site can't silently
// diverge from the other.
export function pictureAnimationKey(
	stageClass: string,
	pictureIndex: number,
): string {
	return `${stageClass}_${pictureIndex + 1}`;
}
