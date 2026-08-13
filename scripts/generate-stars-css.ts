// Generates client/css/stars.css from the ANIMATIONS data in
// server/keyframes.ts. Run it plain to write the file, or with `--check` for
// the drift check that `just check` runs.
//
// Equal behavior is the goal, not byte-identical output: Biome reformats the
// file anyway. This script always emits the two-argument `scale(x, y)` form,
// which computes the same result as the original `scale(n)`.

import {
	ANIMATIONS,
	interpolate,
	type PictureAnimation,
} from "../server/keyframes";

// className matches the ANIMATIONS key for every entry. Only the @keyframes
// animation-name differs from the class name, and only for some entries.
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
