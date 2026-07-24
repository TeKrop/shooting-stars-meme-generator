// erase/color-pick transparency editing on a canvas, with undo/redo history

type Tool = "erase" | "pick";

const MAX_HISTORY = 20;

// draws one erase dab (destination-out) into ctx at (x, y) with the given radius
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

// makes every pixel within `tolerance` color-distance of (x, y) transparent
// (simple Euclidean RGB distance, no edge feathering)
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

	// snapshots the canvas before an edit starts, so it can be undone as one step
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

	// the mobile fullscreen dialog styles #edit-canvas with object-fit:
	// contain, which can letterbox the rendered bitmap inside the element's
	// own box (its aspect ratio no longer has to match the canvas's) — this
	// resolves the actual rendered content rect so pointer math and cursor
	// sizing scale against it instead of the (possibly larger) element box
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

	// draws the brush outline as the canvas cursor itself, so hovering shows
	// exactly what the next erase will cover (scaled from canvas pixels to
	// displayed CSS pixels, since the canvas can be shown smaller than its
	// backing resolution)
	function updateEraseCursor() {
		if (tool !== "erase") return;

		const radius = Number(eraseSizeInput.value);
		if (!Number.isFinite(radius) || radius <= 0) return;

		const displayRadius = (radius * contentRect().width) / canvas.width;
		// rasterize at devicePixelRatio so the outline stays crisp (not
		// blurry-upscaled) on high-DPI screens; cursor hotspot/size are in
		// raster pixels, so everything below is scaled by dpr together
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

	// rect is passed in (rather than calling contentRect() here) so a drag
	// can compute it once at pointerdown and reuse it for every pointermove —
	// getBoundingClientRect() can force a layout reflow, too costly to pay
	// on every move event of a hot drag loop
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
		// computed once for the whole stroke, not per move — see canvasPoint
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

		// touch pointermove can fire faster than the display refreshes;
		// coalesce to at most one erase draw per frame instead of one per event
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
		// 'lostpointercapture' — rather than 'pointerup' alone — is what
		// actually guarantees cleanup: it fires whenever capture ends for
		// any reason (release, pointercancel from a browser gesture/palm
		// rejection, programmatic release), so drag state can never get
		// stuck with a dangling pointermove listener
		const onLostCapture = () => {
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("lostpointercapture", onLostCapture);
		};
		canvas.addEventListener("pointermove", onMove);
		canvas.addEventListener("lostpointercapture", onLostCapture);
	};

	updateHistoryButtons();

	return {
		// clears tool/undo state for a freshly (re-)cropped image
		reset() {
			setTool("erase");
			undoStack = [];
			redoStack = [];
			updateHistoryButtons();
		},
	};
}
