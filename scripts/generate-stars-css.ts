// Generates client/css/stars.css from server/keyframes.ts's ANIMATIONS data
// — keyframes.ts is the canonical animation dataset (see its header
// comment); this script is the other direction of that relationship, so
// the two files can never drift apart silently again.
//
// Run directly (`bun scripts/generate-stars-css.ts`) to write the file, or
// with `--check` (`bun scripts/generate-stars-css.ts --check`, wired as
// `verify:css` in package.json and folded into `just check`) to compare
// the generated text against what's on disk and exit non-zero without
// writing — the drift check.
//
// Byte-identical output isn't the goal (Biome reformats the file anyway,
// see `just format`); behaviorally identical CSS is: same property values
// at the same keyframe percentages. `scale(x, y)` is always emitted in
// two-argument form, even where the original hand-authored CSS used
// `scale(n)` or `scaleX(n)` — computationally identical, no need to
// reconstruct which literal shorthand was originally used.

import {
	ANIMATIONS,
	interpolate,
	type PictureAnimation,
} from "../server/keyframes";

// className is identical to the ANIMATIONS key for every entry; only the
// @keyframes animation-name itself differs from the class name for some.
const ANIMATION_NAME: Record<string, string> = {
	spaceone_1: "spaceone",
	dolphins_1: "dolphins-one",
	dolphins_2: "dolphins-two",
	spacetwo_1: "spacetwo-one",
	spacetwo_2: "spacetwo-two",
	spacetwo_3: "spacetwo-three",
	spacetwo_4: "spacetwo-four",
	spacetwo_5: "spacetwo-five",
	spacetwo_6: "spacetwo-six",
	microone_1: "microone",
	microtwo_1: "microtwo",
};

function realStops(points: { percent: number; implicit?: true }[]): number[] {
	return points.filter((p) => !p.implicit).map((p) => p.percent);
}

function filterText(anim: PictureAnimation, percent: number): string {
	const point = anim.filter.find((p) => p.percent === percent && !p.implicit);
	if (!point) throw new Error(`no explicit filter point at ${percent}%`);
	return point.kind === "saturate"
		? `saturate(${point.amount})`
		: `contrast(${point.amount * 100}%)`;
}

function transformText(anim: PictureAnimation, percent: number): string {
	const x = interpolate(anim.x, percent, 0);
	const y = interpolate(anim.y, percent, 0);
	const translate = `translate(${x}px, ${y}px)`;

	const hasScale =
		anim.scaleX.some((p) => !p.implicit) ||
		anim.scaleY.some((p) => !p.implicit);
	const hasRotate = anim.rotateDeg.some((p) => !p.implicit);
	const rotate = hasRotate
		? `rotate(${interpolate(anim.rotateDeg, percent, 0)}deg)`
		: undefined;
	const scale = hasScale
		? `scale(${interpolate(anim.scaleX, percent, 1)}, ${interpolate(anim.scaleY, percent, 1)})`
		: undefined;

	const functions =
		anim.transformOrder === "scale-rotate"
			? [translate, scale, rotate]
			: [translate, rotate, scale];
	return functions.filter(Boolean).join(" ");
}

function renderKeyframes(key: string, anim: PictureAnimation): string {
	const name = ANIMATION_NAME[key];
	const durationSec = anim.durationMs / 1000;

	const opacityStops = realStops(anim.opacity);
	const filterStops = realStops(anim.filter);
	const transformStops = Array.from(
		new Set([
			...realStops(anim.x),
			...realStops(anim.y),
			...realStops(anim.scaleX),
			...realStops(anim.scaleY),
			...realStops(anim.rotateDeg),
		]),
	);

	const allStops = Array.from(
		new Set([...opacityStops, ...filterStops, ...transformStops]),
	).sort((a, b) => a - b);

	const blocks = allStops.map((percent) => {
		const lines: string[] = [];
		if (opacityStops.includes(percent)) {
			const point = anim.opacity.find((p) => p.percent === percent);
			lines.push(`\t\t\topacity: ${point?.value};`);
		}
		if (filterStops.includes(percent)) {
			lines.push(`\t\t\tfilter: ${filterText(anim, percent)};`);
		}
		if (transformStops.includes(percent)) {
			lines.push(`\t\t\ttransform: ${transformText(anim, percent)};`);
		}
		return `\t\t${percent}% {\n${lines.join("\n")}\n\t\t}`;
	});

	return (
		`\t.${key} {\n` +
		`\t\tanimation: ${name} ${durationSec}s linear infinite;\n` +
		`\t}\n` +
		`\t@keyframes ${name} {\n` +
		`${blocks.join("\n")}\n` +
		`\t}`
	);
}

function generate(): string {
	const sections = Object.entries(ANIMATIONS).map(([key, anim]) =>
		renderKeyframes(key, anim),
	);
	return `@layer stars {\n${sections.join("\n\n")}\n}\n`;
}

const outPath = `${import.meta.dir}/../client/css/stars.css`;
const generated = generate();

if (process.argv.includes("--check")) {
	const current = await Bun.file(outPath).text();
	if (current !== generated) {
		console.error(
			"client/css/stars.css is out of date with server/keyframes.ts — run `bun run generate:css` (or `just generate-css`) to regenerate it.",
		);
		process.exit(1);
	}
	console.log("client/css/stars.css is up to date.");
} else {
	await Bun.write(outPath, generated);
	console.log(`Wrote ${outPath}`);
}
