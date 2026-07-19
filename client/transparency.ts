// erase/color-pick transparency editing on a canvas, with undo/redo history

type Tool = 'erase' | 'pick';

const MAX_HISTORY = 20;

export function initTransparencyTools(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!;

    const eraseBtn = document.getElementById('tool-erase') as HTMLElement;
    const pickBtn = document.getElementById('tool-pick') as HTMLElement;
    const eraseSizeControl = document.getElementById(
        'erase-size-control',
    ) as HTMLElement;
    const pickToleranceControl = document.getElementById(
        'pick-tolerance-control',
    ) as HTMLElement;
    const eraseSizeInput = document.getElementById(
        'erase-size',
    ) as HTMLInputElement;
    const pickToleranceInput = document.getElementById(
        'pick-tolerance',
    ) as HTMLInputElement;
    const undoBtn = document.getElementById('edit-undo') as HTMLButtonElement;
    const redoBtn = document.getElementById('edit-redo') as HTMLButtonElement;

    let tool: Tool = 'erase';
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

    function setTool(next: Tool) {
        tool = next;
        eraseBtn.setAttribute('aria-pressed', String(tool === 'erase'));
        pickBtn.setAttribute('aria-pressed', String(tool === 'pick'));
        eraseSizeControl.hidden = tool !== 'erase';
        pickToleranceControl.hidden = tool !== 'pick';
    }
    eraseBtn.onclick = () => setTool('erase');
    pickBtn.onclick = () => setTool('pick');

    function canvasPoint(e: PointerEvent): { x: number; y: number } {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) * canvas.width) / rect.width,
            y: ((e.clientY - rect.top) * canvas.height) / rect.height,
        };
    }

    function eraseAt(x: number, y: number) {
        const radius = Number(eraseSizeInput.value);
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // makes every pixel within `tolerance` color-distance of the clicked pixel
    // transparent (simple Euclidean RGB distance, no edge feathering)
    function pickColorAt(x: number, y: number) {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        const maxDistance = (Number(pickToleranceInput.value) / 100) * 441.67; // sqrt(255^2 * 3)

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data } = imageData;
        for (let i = 0; i < data.length; i += 4) {
            const dr = data[i] - r;
            const dg = data[i + 1] - g;
            const db = data[i + 2] - b;
            if (Math.sqrt(dr * dr + dg * dg + db * db) <= maxDistance) {
                data[i + 3] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    canvas.onpointerdown = (e: PointerEvent) => {
        const point = canvasPoint(e);
        pushHistory();

        if (tool === 'pick') {
            pickColorAt(point.x, point.y);
            return;
        }

        eraseAt(point.x, point.y);
        canvas.setPointerCapture(e.pointerId);

        const onMove = (moveEvent: PointerEvent) => {
            const p = canvasPoint(moveEvent);
            eraseAt(p.x, p.y);
        };
        const onUp = () => {
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerup', onUp);
        };
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
    };

    updateHistoryButtons();

    return {
        // clears tool/undo state for a freshly (re-)cropped image
        reset() {
            setTool('erase');
            undoStack = [];
            redoStack = [];
            updateHistoryButtons();
        },
    };
}
