// Transparency editing on a canvas. It offers an erase tool and a
// color-pick tool. It keeps an undo history and a redo history.

type Tool = "erase" | "pick";

const MAX_HISTORY = 20;

// Draws one erase mark into ctx at (x, y), with the given radius. It uses
// the destination-out composite operation.
function eraseAt(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
) {
	ctx.save();
	ctx.globalCompositeOperation = "destination-out";
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

// Makes every pixel transparent within `tolerance` color distance of (x, y).
// The measure is a plain Euclidean RGB distance. It feathers no edge.
function pickColorAt(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	x: number,
	y: number,
	tolerance: number,
) {
	const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
	const maxDistance = (tolerance / 100) * 441.67; // sqrt(255^2 * 3)
	const maxDistanceSquared = maxDistance * maxDistance;

	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const { data } = imageData;
	for (let i = 0; i < data.length; i += 4) {
		const dr = data[i] - r;
		const dg = data[i + 1] - g;
		const db = data[i + 2] - b;
		if (dr * dr + dg * dg + db * db <= maxDistanceSquared) {
			data[i + 3] = 0;
		}
	}
	ctx.putImageData(imageData, 0, 0);
}

export function initTransparencyTools(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

	const eraseBtn = document.getElementById("tool-erase") as HTMLElement;
	const pickBtn = document.getElementById("tool-pick") as HTMLElement;
	const eraseSizeControl = document.getElementById(
		"erase-size-control",
	) as HTMLElement;
	const pickToleranceControl = document.getElementById(
		"pick-tolerance-control",
	) as HTMLElement;
	const eraseSizeInput = document.getElementById(
		"erase-size",
	) as HTMLInputElement;
	const pickToleranceInput = document.getElementById(
		"pick-tolerance",
	) as HTMLInputElement;
	const undoBtn = document.getElementById("edit-undo") as HTMLButtonElement;
	const redoBtn = document.getElementById("edit-redo") as HTMLButtonElement;

	let tool: Tool = "erase";
	let undoStack: ImageData[] = [];
	let redoStack: ImageData[] = [];

	function updateHistoryButtons() {
		undoBtn.disabled = undoStack.length === 0;
		redoBtn.disabled = redoStack.length === 0;
	}

	// Takes a canvas snapshot before an edit starts. One undo step therefore
	// reverses the whole edit.
	function pushHistory() {
		undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
		if (undoStack.length > MAX_HISTORY) undoStack.shift();
		redoStack = [];
		updateHistoryButtons();
	}

	undoBtn.onclick = () => {
		const snapshot = undoStack.pop();
		if (!snapshot) return;
		redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
		ctx.putImageData(snapshot, 0, 0);
		updateHistoryButtons();
	};

	redoBtn.onclick = () => {
		const snapshot = redoStack.pop();
		if (!snapshot) return;
		undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
		ctx.putImageData(snapshot, 0, 0);
		updateHistoryButtons();
	};

	// The mobile dialog styles #edit-canvas with `object-fit: contain`, which
	// can letterbox the bitmap inside the element box. This returns the real
	// content rect, so pointer math and cursor size scale against it.
	function contentRect() {
		const rect = canvas.getBoundingClientRect();
		const scale = Math.min(
			rect.width / canvas.width,
			rect.height / canvas.height,
		);
		const width = canvas.width * scale;
		const height = canvas.height * scale;
		return {
			left: rect.left + (rect.width - width) / 2,
			top: rect.top + (rect.height - height) / 2,
			width,
			height,
		};
	}

	// Draws the brush outline as the canvas cursor, so a hover shows the exact
	// area of the next erase. The radius scales from canvas pixels to CSS
	// pixels: the canvas can appear smaller than its backing resolution.
	function updateEraseCursor() {
		if (tool !== "erase") return;

		const radius = Number(eraseSizeInput.value);
		if (!Number.isFinite(radius) || radius <= 0) return;

		const displayRadius = (radius * contentRect().width) / canvas.width;
		// Rasterizes at devicePixelRatio so the outline stays sharp on a
		// high-DPI screen. Hotspot and size are in raster pixels, so every
		// value below scales by dpr together.
		const dpr = window.devicePixelRatio || 1;
		const size = (Math.ceil(displayRadius) * 2 + 2) * dpr;
		const center = size / 2;
		const r = displayRadius * dpr;
		const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='white' stroke-width='${1.5 * dpr}'/><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='black' stroke-width='${dpr}' stroke-dasharray='${3 * dpr}'/></svg>`;
		canvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${center} ${center}, crosshair`;
	}
	eraseSizeInput.oninput = updateEraseCursor;

	function setTool(next: Tool) {
		tool = next;
		eraseBtn.setAttribute("aria-pressed", String(tool === "erase"));
		pickBtn.setAttribute("aria-pressed", String(tool === "pick"));
		eraseSizeControl.hidden = tool !== "erase";
		pickToleranceControl.hidden = tool !== "pick";
		if (tool === "erase") updateEraseCursor();
		else canvas.style.cursor = "";
	}
	eraseBtn.onclick = () => setTool("erase");
	pickBtn.onclick = () => setTool("pick");

	// The caller passes `rect` in, so a drag computes it once at pointerdown
	// and reuses it. getBoundingClientRect() can force a layout reflow, too
	// costly for every event of a drag loop.
	function canvasPoint(
		e: PointerEvent,
		rect: ReturnType<typeof contentRect>,
	): { x: number; y: number } {
		return {
			x: ((e.clientX - rect.left) * canvas.width) / rect.width,
			y: ((e.clientY - rect.top) * canvas.height) / rect.height,
		};
	}

	canvas.onpointerdown = (e: PointerEvent) => {
		// Computed once for the whole stroke, not per move. See canvasPoint.
		const rect = contentRect();
		const point = canvasPoint(e, rect);
		pushHistory();

		if (tool === "pick") {
			pickColorAt(
				ctx,
				canvas,
				point.x,
				point.y,
				Number(pickToleranceInput.value),
			);
			return;
		}

		eraseAt(ctx, point.x, point.y, Number(eraseSizeInput.value));
		canvas.setPointerCapture(e.pointerId);

		// A touch pointermove event can arrive faster than the display
		// refreshes. This code draws at most one erase mark per frame.
		let pendingPoint: { x: number; y: number } | null = null;
		let rafScheduled = false;
		const onMove = (moveEvent: PointerEvent) => {
			pendingPoint = canvasPoint(moveEvent, rect);
			if (rafScheduled) return;
			rafScheduled = true;
			requestAnimationFrame(() => {
				rafScheduled = false;
				if (pendingPoint) {
					eraseAt(
						ctx,
						pendingPoint.x,
						pendingPoint.y,
						Number(eraseSizeInput.value),
					);
				}
			});
		};
		// 'lostpointercapture' guarantees the cleanup where 'pointerup'
		// alone does not: the browser sends it whenever capture ends, for a
		// release, a palm rejection, or a release from code.
		const onLostCapture = () => {
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("lostpointercapture", onLostCapture);
		};
		canvas.addEventListener("pointermove", onMove);
		canvas.addEventListener("lostpointercapture", onLostCapture);
	};

	updateHistoryButtons();

	return {
		// Clears the tool state and the undo state for a new crop.
		reset() {
			setTool("erase");
			undoStack = [];
			redoStack = [];
			updateHistoryButtons();
		},
	};
}
