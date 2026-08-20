import { describe, expect, test } from "bun:test";
import {
	ANIMATION_TIMELINE,
	pictureAnimationKey,
} from "../client/animation-timeline";
import { ANIMATIONS } from "../server/keyframes";

// The same picture id list as `pictures` in client/animation.ts. It also
// matches `pictureIds` in server/export.ts. Neither file exports its list.
// This is therefore a third small copy. A shared export is not necessary.
const pictureIds = ["pict1", "pict2", "pict3", "pict4", "pict5", "pict6"];

describe("ANIMATION_TIMELINE", () => {
	test("computed offsets match the stage gaps", () => {
		expect(Object.keys(ANIMATION_TIMELINE).map(Number)).toEqual([
			0, 3900, 7700, 11600, 15500, 17700, 23200,
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
