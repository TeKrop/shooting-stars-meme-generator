// Pure data, with no DOM access. The split from animation.ts lets
// server/export.ts import the choreography table alone: the top-level
// `document.getElementById(...)` calls there throw under `bun test`.

export type AnimationStage = {
	class: string;
	pictures: string[];
};

// Relative gaps, in milliseconds since the previous stage started. Absolute
// offsets would force a recount of every later key after one retiming.
// gapMs derives from nothing else. A stage is a staggered entrance, not a
// full loop, so its animation duration is not its gap to the next stage.
// Keep these in step with stars.css and background.mp4 by hand.
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
	{ class: "microone", gapMs: 3900, pictures: ["pict1"] },
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

// The choreography table: a millisecond offset from startAnimation() to the
// active stage class and its visible pictN ids. server/export.ts shares it,
// so both sides drive the same timeline.
export const ANIMATION_TIMELINE: Record<number, AnimationStage> =
	buildTimeline(STAGE_DEFS);

// The `${stageClass}_${pictureIndex + 1}` convention that keys both
// ANIMATIONS and the stars.css class selectors. One function, so a typo or a
// renumbering cannot make two call sites disagree.
export function pictureAnimationKey(
	stageClass: string,
	pictureIndex: number,
): string {
	return `${stageClass}_${pictureIndex + 1}`;
}
