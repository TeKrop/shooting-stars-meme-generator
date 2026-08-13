// The entry point for the worker thread. renderExportInWorker() in
// server/export.ts starts it. It runs the canvas rendering and the ffmpeg
// pipeline off the thread that serves HTTP requests. It reports back over
// parentPort: progress ticks, then a final result. It returns no value. A
// worker_threads result is a message, not an awaited call.

import { parentPort, workerData } from "node:worker_threads";
import type { ExportJob } from "./export";
import { renderExport } from "./export";

const { imagePath, orientation, resolution, fps, format, dir } =
	workerData as ExportJob;

try {
	const outputPath = await renderExport(
		imagePath,
		orientation,
		resolution,
		fps,
		format,
		dir,
		(percent) => {
			parentPort?.postMessage({ type: "progress", percent });
		},
	);
	parentPort?.postMessage({ type: "done", outputPath });
} catch (err) {
	parentPort?.postMessage({
		type: "error",
		message: err instanceof Error ? err.message : String(err),
	});
}
