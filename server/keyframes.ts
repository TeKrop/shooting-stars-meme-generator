// Hand-ported copy of client/css/stars.css's @keyframes, for the /export
// route to render frames without a browser (see server/export.ts). This is
// the canonical animation dataset: scripts/generate-stars-css.ts generates
// client/css/stars.css *from* this file, so edit here first, then run
// `just generate-css` (or `bun run generate:css`) to regenerate the CSS —
// `just check` runs the generator in --check mode and fails if the two
// files disagree, so drift between them can't go unnoticed the way it did
// before this generator existed.
//
// A control-point array only lists the CSS keyframe percentages where the
// source actually specifies that property. Where stars.css omits a
// property for part of an animation (e.g. spacetwo_3's transform/filter
// only start at 50%, spacetwo_1's filter only starts at 60%), the browser
// synthesizes an implicit "identity" value at the 0%/100% boundary and
// interpolates from there — those synthetic points are written out
// explicitly below and marked `implicit: true`, so every array already
// spans 0-100 and the interpolator never needs special-case boundary
// logic. The generator reads the same flag to know NOT to emit that
// property at that percentage, since it isn't actually in the source CSS.

type ControlPoint = { percent: number; value: number; implicit?: true };

type FilterKind = "none" | "saturate" | "contrast";
type FilterControlPoint = {
	percent: number;
	kind: FilterKind;
	amount: number;
	implicit?: true;
};

// stars.css doesn't use one consistent order for the transform functions:
// spaceone/dolphins-two write `translate() scale() rotate()`, while
// spacetwo-*/microone/microtwo write `translate() rotate() scale()` — CSS
// composes transform functions in written order (the rightmost function
// applies to the point first), so these produce genuinely different
// results and server/export.ts's canvas rendering must replicate whichever
// order the source animation actually uses.
type TransformOrder = "scale-rotate" | "rotate-scale";

export type PictureAnimation = {
	durationMs: number;
	transformOrder: TransformOrder;
	x: ControlPoint[];
	y: ControlPoint[];
	scaleX: ControlPoint[];
	scaleY: ControlPoint[];
	rotateDeg: ControlPoint[];
	opacity: ControlPoint[];
	filter: FilterControlPoint[];
};

export type ResolvedFrame = {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	rotateDeg: number;
	opacity: number;
	filter: { kind: FilterKind; amount: number };
};

const pts = (
	...pairs: ([number, number] | [number, number, true])[]
): ControlPoint[] =>
	pairs.map(([percent, value, implicit]) =>
		implicit ? { percent, value, implicit } : { percent, value },
	);

const filterPts = (
	...pairs: (
		| [number, FilterKind, number]
		| [number, FilterKind, number, true]
	)[]
): FilterControlPoint[] =>
	pairs.map(([percent, kind, amount, implicit]) =>
		implicit ? { percent, kind, amount, implicit } : { percent, kind, amount },
	);

// spaceone's single-argument `scale(n)` applies uniformly to both axes —
// shared by scaleX and scaleY below rather than duplicated literally.
const spaceoneScale: ControlPoint[] = pts(
	[0, 2],
	[5, 1.95],
	[10, 1.9],
	[15, 1.85],
	[20, 1.8],
	[25, 1.75],
	[30, 1.7],
	[35, 1.65],
	[40, 1.6],
	[45, 1.55],
	[50, 1.5],
	[55, 1.45],
	[60, 1.4],
	[65, 1.35],
	[70, 1.3],
	[75, 1.25],
	[80, 1.2],
	[85, 1.15],
	[90, 1.1],
	[95, 1.05],
	[100, 1],
);

export const ANIMATIONS: Record<string, PictureAnimation> = {
	spaceone_1: {
		durationMs: 4200,
		transformOrder: "scale-rotate",
		x: pts(
			[0, 1000],
			[5, 975],
			[10, 900],
			[15, 925],
			[20, 800],
			[25, 825],
			[30, 700],
			[35, 725],
			[40, 600],
			[45, 625],
			[50, 500],
			[55, 525],
			[60, 400],
			[65, 425],
			[70, 300],
			[75, 325],
			[80, 200],
			[85, 225],
			[90, 100],
			[95, 125],
			[100, 0],
		),
		y: pts(
			[0, -500],
			[5, -500],
			[10, -425],
			[15, -450],
			[20, -375],
			[25, -400],
			[30, -325],
			[35, -350],
			[40, -275],
			[45, -300],
			[50, -225],
			[55, -250],
			[60, -175],
			[65, -200],
			[70, -125],
			[75, -150],
			[80, -75],
			[85, -100],
			[90, -25],
			[95, -50],
			[100, 0],
		),
		scaleX: spaceoneScale,
		scaleY: spaceoneScale,
		rotateDeg: pts(
			[0, -90],
			[5, -94.5],
			[10, -99],
			[15, -103.5],
			[20, -108],
			[25, -112.5],
			[30, -117],
			[35, -121.5],
			[40, -126],
			[45, -130.5],
			[50, -135],
			[55, -139.5],
			[60, -144],
			[65, -148.5],
			[70, -153],
			[75, -157.5],
			[80, -162],
			[85, -166.5],
			[90, -171],
			[95, -175.5],
			[100, -180],
		),
		opacity: [],
		filter: filterPts(
			[0, "saturate", 5],
			[5, "saturate", 2.5],
			[10, "saturate", 0],
			[15, "saturate", 2.5],
			[20, "saturate", 5],
			[25, "saturate", 2.5],
			[30, "saturate", 0],
			[35, "saturate", 2.5],
			[40, "saturate", 5],
			[45, "saturate", 2.5],
			[50, "saturate", 0],
			[55, "saturate", 2.5],
			[60, "saturate", 5],
			[65, "saturate", 2.5],
			[70, "saturate", 0],
			[75, "saturate", 2.5],
			[80, "saturate", 5],
			[85, "saturate", 2.5],
			[90, "saturate", 0],
			[95, "saturate", 2.5],
			[100, "saturate", 5],
		),
	},

	dolphins_1: {
		durationMs: 4000,
		// no scale in this animation at all, so scale/rotate order can't
		// actually be observed — grouped with its rotate-scale sibling
		// (dolphins_2 uses scale-rotate, so dolphins_1's own written order,
		// translate/rotate only, doesn't collide with either)
		transformOrder: "rotate-scale",
		x: pts(
			[0, 1000],
			[10, 900],
			[20, 800],
			[30, 700],
			[40, 600],
			[50, 500],
			[60, 400],
			[70, 300],
			[80, 200],
			[90, 100],
			[100, 0],
		),
		y: pts(
			[0, -300],
			[10, -270],
			[20, -240],
			[30, -210],
			[40, -180],
			[50, -150],
			[60, -120],
			[70, -90],
			[80, -60],
			[90, -30],
			[100, 0],
		),
		scaleX: [],
		scaleY: [],
		rotateDeg: pts(
			[0, -100],
			[10, -80],
			[20, -120],
			[30, -80],
			[40, -120],
			[50, -80],
			[60, -120],
			[70, -80],
			[80, -120],
			[90, -80],
			[100, -120],
		),
		opacity: [],
		filter: [],
	},

	dolphins_2: {
		durationMs: 4000,
		transformOrder: "scale-rotate",
		x: pts(
			[0, 1200],
			[10, 960],
			[20, 720],
			[30, 480],
			[40, 240],
			[50, 0],
			[60, -240],
			[70, -480],
			[80, -720],
			[90, -960],
			[100, -1200],
		),
		y: pts(
			[0, 400],
			[10, 360],
			[20, 320],
			[30, 280],
			[40, 240],
			[50, 200],
			[60, 160],
			[70, 120],
			[80, 80],
			[90, 40],
			[100, 0],
		),
		scaleX: pts(
			[0, 2.5],
			[10, 2.4],
			[20, 2.3],
			[30, 2.2],
			[40, 2.1],
			[50, 2],
			[60, 1.9],
			[70, 1.8],
			[80, 1.7],
			[90, 1.6],
			[100, 1.5],
		),
		scaleY: pts(
			[0, 2.5],
			[10, 2.4],
			[20, 2.3],
			[30, 2.2],
			[40, 2.1],
			[50, 2],
			[60, 1.9],
			[70, 1.8],
			[80, 1.7],
			[90, 1.6],
			[100, 1.5],
		),
		rotateDeg: pts(
			[0, -100],
			[10, -50],
			[20, -110],
			[30, -50],
			[40, -110],
			[50, -50],
			[60, -110],
			[70, -50],
			[80, -110],
			[90, -50],
			[100, -90],
		),
		opacity: [],
		filter: [],
	},

	spacetwo_1: {
		durationMs: 4000,
		transformOrder: "rotate-scale",
		x: pts(
			[0, -1000],
			[10, -800],
			[20, -600],
			[30, -400],
			[40, -200],
			[50, 0],
			[60, -160],
			[70, -320],
			[80, -480],
			[90, -640],
			[100, -800],
		),
		y: pts(
			[0, 600],
			[10, 480],
			[20, 360],
			[30, 240],
			[40, 120],
			[50, 0],
			[60, -100],
			[70, -200],
			[80, -300],
			[90, -400],
			[100, -500],
		),
		scaleX: pts([0, -1.5]), // constant across the whole animation
		scaleY: pts([0, 1.5]),
		rotateDeg: pts(
			[0, 40],
			[10, 0],
			[20, 40],
			[30, 0],
			[40, 40],
			[50, 0],
			[60, -40],
			[70, 0],
			[80, -40],
			[90, 0],
			[100, -40],
		),
		opacity: [],
		filter: filterPts(
			[0, "none", 1, true], // implicit boundary — filter only declared from 60%
			[60, "contrast", 3],
			[70, "contrast", 3],
			[80, "contrast", 3],
			[90, "contrast", 3],
			[100, "contrast", 3],
		),
	},

	spacetwo_2: {
		durationMs: 4000,
		transformOrder: "rotate-scale",
		x: pts(
			[0, 1000],
			[10, 800],
			[20, 600],
			[30, 400],
			[40, 200],
			[50, 0],
			[60, 120],
			[70, 240],
			[80, 360],
			[90, 480],
			[100, 600],
		),
		y: pts(
			[0, 600],
			[10, 480],
			[20, 360],
			[30, 240],
			[40, 120],
			[50, 0],
			[60, -140],
			[70, -280],
			[80, -420],
			[90, -560],
			[100, -700],
		),
		scaleX: pts([0, 1.5]),
		scaleY: pts([0, 1.5]),
		rotateDeg: pts(
			[0, -40],
			[10, 0],
			[20, -40],
			[30, 0],
			[40, -40],
			[50, 0],
			[60, 40],
			[70, 0],
			[80, 40],
			[90, 0],
			[100, 40],
		),
		opacity: [],
		filter: filterPts(
			[0, "none", 1, true], // implicit boundary — filter only declared from 50%
			[50, "contrast", 3],
			[60, "contrast", 3],
			[70, "contrast", 3],
			[80, "contrast", 3],
			[90, "contrast", 3],
			[100, "contrast", 3],
		),
	},

	spacetwo_3: {
		durationMs: 4000,
		transformOrder: "rotate-scale",
		x: pts(
			[0, 0, true], // implicit boundary — transform only declared from 50%
			[50, 0],
			[60, -200],
			[70, -400],
			[80, -600],
			[90, -800],
			[100, -1000],
		),
		y: pts([0, 0, true], [50, 0], [60, 0], [70, 0], [80, 0], [90, 0], [100, 0]),
		scaleX: [],
		scaleY: [],
		rotateDeg: pts(
			[0, 0, true],
			[50, -90],
			[60, -70],
			[70, -110],
			[80, -70],
			[90, -110],
			[100, -90],
		),
		opacity: pts(
			[0, 0],
			[10, 0],
			[20, 0],
			[30, 0],
			[40, 0],
			[50, 1],
			[60, 1],
			[70, 1],
			[80, 1],
			[90, 1],
			[100, 1],
		),
		filter: filterPts(
			[0, "none", 1, true], // implicit boundary — filter only declared from 50%
			[50, "contrast", 3],
			[60, "contrast", 3],
			[70, "contrast", 3],
			[80, "contrast", 3],
			[90, "contrast", 3],
			[100, "contrast", 3],
		),
	},

	spacetwo_4: {
		durationMs: 4000,
		transformOrder: "rotate-scale",
		x: pts(
			[0, 0, true], // implicit boundary — transform only declared from 50%
			[50, 0],
			[60, 200],
			[70, 400],
			[80, 600],
			[90, 800],
			[100, 1000],
		),
		y: pts([0, 0, true], [50, 0], [60, 0], [70, 0], [80, 0], [90, 0], [100, 0]),
		scaleX: pts(
			[0, 1, true], // implicit boundary — scaleX(-1) flip starts at 50%
			[50, -1],
			[60, -1],
			[70, -1],
			[80, -1],
			[90, -1],
			[100, -1],
		),
		scaleY: [],
		rotateDeg: pts(
			[0, 0, true],
			[50, 90],
			[60, 70],
			[70, 110],
			[80, 70],
			[90, 110],
			[100, 90],
		),
		opacity: pts(
			[0, 0],
			[10, 0],
			[20, 0],
			[30, 0],
			[40, 0],
			[50, 1],
			[60, 1],
			[70, 1],
			[80, 1],
			[90, 1],
			[100, 1],
		),
		filter: filterPts(
			[0, "none", 1, true],
			[50, "contrast", 3],
			[60, "contrast", 3],
			[70, "contrast", 3],
			[80, "contrast", 3],
			[90, "contrast", 3],
			[100, "contrast", 3],
		),
	},

	spacetwo_5: {
		durationMs: 4000,
		transformOrder: "rotate-scale",
		x: pts(
			[0, 0, true], // implicit boundary — transform only declared from 50%
			[50, 0],
			[60, -60],
			[70, -120],
			[80, -180],
			[90, -240],
			[100, -300],
		),
		y: pts(
			[0, 0, true],
			[50, 0],
			[60, 120],
			[70, 240],
			[80, 360],
			[90, 480],
			[100, 600],
		),
		scaleX: [],
		scaleY: [],
		rotateDeg: pts(
			[0, 0, true],
			[50, -140],
			[60, -120],
			[70, -160],
			[80, -120],
			[90, -160],
			[100, -140],
		),
		opacity: pts(
			[0, 0],
			[10, 0],
			[20, 0],
			[30, 0],
			[40, 0],
			[50, 1],
			[60, 1],
			[70, 1],
			[80, 1],
			[90, 1],
			[100, 1],
		),
		filter: filterPts(
			[0, "none", 1, true],
			[50, "contrast", 3],
			[60, "contrast", 3],
			[70, "contrast", 3],
			[80, "contrast", 3],
			[90, "contrast", 3],
			[100, "contrast", 3],
		),
	},

	spacetwo_6: {
		durationMs: 4000,
		transformOrder: "rotate-scale",
		x: pts(
			[0, 0, true], // implicit boundary — transform only declared from 50%
			[50, 0],
			[60, 240],
			[70, 480],
			[80, 720],
			[90, 960],
			[100, 1200],
		),
		y: pts(
			[0, 0, true],
			[50, 0],
			[60, 120],
			[70, 240],
			[80, 360],
			[90, 480],
			[100, 600],
		),
		scaleX: pts(
			[0, 1, true], // implicit boundary — scaleX(-1) flip starts at 50%
			[50, -1],
			[60, -1],
			[70, -1],
			[80, -1],
			[90, -1],
			[100, -1],
		),
		scaleY: [],
		rotateDeg: pts(
			[0, 0, true],
			[50, 150],
			[60, 170],
			[70, 130],
			[80, 170],
			[90, 130],
			[100, 150],
		),
		opacity: pts(
			[0, 0],
			[10, 0],
			[20, 0],
			[30, 0],
			[40, 0],
			[50, 1],
			[60, 1],
			[70, 1],
			[80, 1],
			[90, 1],
			[100, 1],
		),
		filter: filterPts(
			[0, "none", 1, true],
			[50, "contrast", 3],
			[60, "contrast", 3],
			[70, "contrast", 3],
			[80, "contrast", 3],
			[90, "contrast", 3],
			[100, "contrast", 3],
		),
	},

	microone_1: {
		durationMs: 3500,
		transformOrder: "rotate-scale",
		x: pts([0, 0], [15, -300], [100, -50]),
		y: pts([0, -200], [15, 150], [100, 0]),
		scaleX: pts([0, -0.5], [15, -2.5], [100, -0.5]),
		scaleY: pts([0, 0.5], [15, 2.5], [100, 0.5]),
		rotateDeg: pts([0, 90], [15, 160], [100, 100]),
		opacity: [],
		filter: [],
	},

	microtwo_1: {
		durationMs: 5500,
		transformOrder: "rotate-scale",
		x: pts(
			[0, -400],
			[15, -600],
			[25, -400],
			[30, 900],
			[35, 1200],
			[40, 0],
			[65, 200],
			[75, 100],
			[85, 0],
			[95, -50],
			[100, 0],
		),
		y: pts(
			[0, -300],
			[15, -200],
			[25, 0],
			[30, 300],
			[35, 200],
			[40, 100],
			[65, 150],
			[75, 100],
			[85, 50],
			[95, 0],
			[100, 0],
		),
		scaleX: pts(
			[0, -0.5],
			[15, -2.5],
			[25, -4],
			[30, -7],
			[35, -3],
			[40, -2],
			[65, -1.7],
			[75, -1.5],
			[85, -1.2],
			[95, -0.8],
			[100, -0.6],
		),
		scaleY: pts(
			[0, 0.5],
			[15, 2.5],
			[25, 4],
			[30, 7],
			[35, 3],
			[40, 2],
			[65, 1.7],
			[75, 1.5],
			[85, 1.2],
			[95, 0.8],
			[100, 0.6],
		),
		rotateDeg: pts(
			[0, 100],
			[15, 90],
			[25, 95],
			[30, 100],
			[35, 90],
			[40, 90],
			[65, 100],
			[75, 90],
			[85, 90],
			[95, 100],
			[100, 100],
		),
		opacity: [],
		filter: [],
	},
};

export function interpolate(
	points: ControlPoint[],
	percent: number,
	identity: number,
): number {
	if (points.length === 0) return identity;
	if (points.length === 1) return points[0].value;
	if (percent <= points[0].percent) return points[0].value;
	const last = points[points.length - 1];
	if (percent >= last.percent) return last.value;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (percent >= a.percent && percent <= b.percent) {
			const localT = (percent - a.percent) / (b.percent - a.percent);
			return a.value + (b.value - a.value) * localT;
		}
	}
	return identity;
}

function interpolateFilter(
	points: FilterControlPoint[],
	percent: number,
): { kind: FilterKind; amount: number } {
	if (points.length === 0) return { kind: "none", amount: 1 };
	const kind = points.find((p) => p.kind !== "none")?.kind ?? "none";
	const amount = interpolate(
		points.map((p) => ({ percent: p.percent, value: p.amount })),
		percent,
		1,
	);
	return { kind, amount };
}

// elapsedMs is time since the picture's stage became active (not since the
// whole export started) — matches how stars.css's `infinite` keyframe
// timelines restart at 0% every time a stage swaps in a fresh class.
export function resolvePictureFrame(
	anim: PictureAnimation,
	elapsedMs: number,
): ResolvedFrame {
	const percent = ((elapsedMs % anim.durationMs) / anim.durationMs) * 100;
	return {
		x: interpolate(anim.x, percent, 0),
		y: interpolate(anim.y, percent, 0),
		scaleX: interpolate(anim.scaleX, percent, 1),
		scaleY: interpolate(anim.scaleY, percent, 1),
		rotateDeg: interpolate(anim.rotateDeg, percent, 0),
		opacity: interpolate(anim.opacity, percent, 1),
		filter: interpolateFilter(anim.filter, percent),
	};
}
