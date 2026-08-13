import { describe, expect, test } from "bun:test";
import { ANIMATION_TIMELINE } from "../client/animation-timeline.ts";
import { testInternals } from "../server/export.ts";
import {
	interpolate,
	type PictureAnimation,
	resolvePictureFrame,
} from "../server/keyframes.ts";

const {
	travelScale,
	pictureBox,
	findStage,
	cssFilterString,
	renderFilterChain,
	renderFilterComplex,
	buildFilterComplex,
} = testInternals;

describe("interpolate", () => {
	test("returns the identity value for an empty control-point array", () => {
		expect(interpolate([], 50, 42)).toBe(42);
	});

	test("returns the single point's value regardless of percent", () => {
		const points = [{ percent: 30, value: 7 }];
		expect(interpolate(points, 0, 0)).toBe(7);
		expect(interpolate(points, 100, 0)).toBe(7);
	});

	test("clamps to the first point before it, and the last point after it", () => {
		const points = [
			{ percent: 20, value: 10 },
			{ percent: 80, value: 90 },
		];
		expect(interpolate(points, 0, 0)).toBe(10);
		expect(interpolate(points, 100, 0)).toBe(90);
	});

	test("linearly interpolates between the surrounding two points", () => {
		const points = [
			{ percent: 0, value: 0 },
			{ percent: 100, value: 200 },
		];
		expect(interpolate(points, 25, 0)).toBe(50);
	});
});

describe("resolvePictureFrame", () => {
	// Copies the shape of spacetwo_3. The transform and the filter start at
	// 50%. An implicit identity point at 0% gives the interpolator a start.
	const anim: PictureAnimation = {
		durationMs: 1000,
		transformOrder: "rotate-scale",
		x: [
			{ percent: 0, value: 0, implicit: true },
			{ percent: 50, value: 0 },
			{ percent: 100, value: -100 },
		],
		y: [],
		scaleX: [],
		scaleY: [],
		rotateDeg: [
			{ percent: 0, value: 0, implicit: true },
			{ percent: 50, value: -90 },
			{ percent: 100, value: -90 },
		],
		opacity: [
			{ percent: 0, value: 0 },
			{ percent: 50, value: 1 },
			{ percent: 100, value: 1 },
		],
		filter: [
			{ percent: 0, kind: "none", amount: 1, implicit: true },
			{ percent: 50, kind: "contrast", amount: 3 },
			{ percent: 100, kind: "contrast", amount: 3 },
		],
	};

	test("resolves the identity boundary at elapsed=0", () => {
		const frame = resolvePictureFrame(anim, 0);
		expect(frame.x).toBe(0);
		expect(frame.scaleX).toBe(1); // No control point gives the identity.
		expect(frame.rotateDeg).toBe(0);
		expect(frame.opacity).toBe(0);
		// The kind comes from the first point that is not "none". The queried
		// percentage does not change it. Only the amount interpolates.
		expect(frame.filter).toEqual({ kind: "contrast", amount: 1 });
	});

	test("resolves mid-segment values between two real control points", () => {
		const frame = resolvePictureFrame(anim, 750);
		expect(frame.x).toBe(-50); // Half way between 50% (-0) and 100% (-100).
		expect(frame.filter.amount).toBe(3);
	});

	test("wraps elapsed time around durationMs, matching CSS's infinite keyframe loop", () => {
		const early = resolvePictureFrame(anim, 500);
		const wrapped = resolvePictureFrame(anim, 1500);
		expect(wrapped).toEqual(early);
	});
});

describe("travelScale", () => {
	test("clamps to the floor below 1400*0.25 viewport width", () => {
		expect(travelScale(200)).toBe(0.25);
	});

	test("clamps to the ceiling above 1400 viewport width", () => {
		expect(travelScale(2800)).toBe(1);
	});

	test("scales linearly against 1400 in between", () => {
		expect(travelScale(700)).toBe(0.5);
	});
});

describe("pictureBox", () => {
	test("fits 30% of the viewport, scaled by travel-scale", () => {
		expect(pictureBox({ width: 1000, height: 500 }, 0.5)).toEqual({
			width: 600,
			height: 300,
		});
	});
});

describe("findStage", () => {
	test("returns the active stage for an exact boundary timestamp", () => {
		expect(findStage(3900).class).toBe("spaceone");
	});

	test("returns the previous stage for a timestamp between boundaries", () => {
		expect(findStage(3899).class).toBe("init");
		expect(findStage(7699).class).toBe("spaceone");
	});

	test("returns the last stage once past every boundary", () => {
		const lastOffset = Math.max(...Object.keys(ANIMATION_TIMELINE).map(Number));
		expect(findStage(lastOffset + 100_000).class).toBe(
			ANIMATION_TIMELINE[lastOffset].class,
		);
	});
});

describe("cssFilterString", () => {
	test("renders 'none' as a bare passthrough", () => {
		expect(cssFilterString({ kind: "none", amount: 1 })).toBe("none");
	});

	test("renders saturate/contrast as a percent function", () => {
		expect(cssFilterString({ kind: "saturate", amount: 2.5 })).toBe(
			"saturate(250%)",
		);
		expect(cssFilterString({ kind: "contrast", amount: 3 })).toBe(
			"contrast(300%)",
		);
	});
});

describe("renderFilterChain / renderFilterComplex", () => {
	test("joins inputs, args-bearing steps, and outputs into an ffmpeg chain string", () => {
		expect(
			renderFilterChain({
				inputs: ["0:v"],
				steps: [{ filter: "scale", args: { w: 100, h: 50 } }],
				outputs: ["bg"],
			}),
		).toBe("[0:v]scale=w=100:h=50[bg]");
	});

	test("omits the '=' for a step with no args", () => {
		expect(renderFilterChain({ steps: [{ filter: "split" }] })).toBe("split");
	});

	test("joins multiple chains with ';'", () => {
		expect(
			renderFilterComplex([
				{ steps: [{ filter: "a" }] },
				{ steps: [{ filter: "b" }] },
			]),
		).toBe("a;b");
	});
});

describe("buildFilterComplex", () => {
	const viewport = { width: 100, height: 50 };

	test("builds the scale/crop/fps/overlay graph for a video format", () => {
		expect(buildFilterComplex(viewport, 24, "mp4")).toBe(
			"[0:v]scale=w=100:h=50:force_original_aspect_ratio=increase,crop=w=100:h=50,fps=fps=24[bg];" +
				"[bg][1:v]overlay=shortest=1[comp]",
		);
	});

	test("appends the palettegen/paletteuse pass for gif", () => {
		expect(buildFilterComplex(viewport, 24, "gif")).toBe(
			"[0:v]scale=w=100:h=50:force_original_aspect_ratio=increase,crop=w=100:h=50,fps=fps=24[bg];" +
				"[bg][1:v]overlay=shortest=1[comp];" +
				"[comp]split[a][b];" +
				"[a]palettegen[pal];" +
				"[b][pal]paletteuse=dither=bayer:bayer_scale=5[out]",
		);
	});
});
