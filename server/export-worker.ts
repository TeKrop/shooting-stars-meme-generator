// Entry point for the worker thread spawned by renderExportInWorker() in
// server/export.ts — runs the actual canvas-rendering + ffmpeg pipeline off
// the thread that serves HTTP requests. Communicates back over parentPort
// (progress ticks, then a final result) rather than a return value, since
// worker_threads results are message-based, not a plain awaited call.

import { parentPort, workerData } from "node:worker_threads";
import type { ExportJob } from "./export";
import { renderExport } from "./export";

const { imagePath, orientation, format, dir } = workerData as ExportJob;

try {
	const outputPath = await renderExport(
		imagePath,
		orientation,
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
