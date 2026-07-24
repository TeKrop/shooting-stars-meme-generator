import { describe, expect, test } from "bun:test";
import {
	ANIMATION_TIMELINE,
	pictureAnimationKey,
} from "../client/animation-timeline";
import { ANIMATIONS } from "../server/keyframes";

// same picture id list as client/animation.ts's `pictures` and
// server/export.ts's `pictureIds` — not exported from either, so this is a
// third small literal copy rather than introducing a shared export nobody
// asked for.
const pictureIds = ["pict1", "pict2", "pict3", "pict4", "pict5", "pict6"];

describe("ANIMATION_TIMELINE", () => {
	test("computed offsets match the original hardcoded timeline", () => {
		expect(Object.keys(ANIMATION_TIMELINE).map(Number)).toEqual([
			0, 3900, 7700, 11600, 15500, 17100, 19300, 24800,
		]);
	});

	test("every picture visible in a stage has a matching ANIMATIONS entry", () => {
		for (const stage of Object.values(ANIMATION_TIMELINE)) {
			pictureIds.forEach((pictureId, i) => {
				if (!stage.pictures.includes(pictureId)) return;
				const key = pictureAnimationKey(stage.class, i);
				expect(ANIMATIONS[key]).toBeDefined();
			});
		}
	});
});
