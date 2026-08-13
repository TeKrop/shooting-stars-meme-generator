import { randomInt } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import index from "../client/index.html";
import {
	clampForGif,
	DEFAULT_FORMAT,
	DEFAULT_FPS,
	DEFAULT_RESOLUTION,
	EXPORT_FORMATS,
	type ExportFormat,
	FRAME_RATES,
	type FrameRate,
	type Orientation,
	RESOLUTIONS,
	type Resolution,
	renderExportInWorker,
} from "./export";

// Fixed on purpose. The app always listens on 9595, in a container or on
// the host. Only the host-side Docker port map changes, through APP_PORT.
const HTTP_PORT = 9595;
const HASH_LENGTH = parseInt(process.env.HASH_LENGTH || "5", 10); // Hash length for the URL of an upload.
// ponytail: collision odds are about 1e-8 at the default HASH_LENGTH. After
// every attempt collides, the code overwrites instead of raising an error.
const MAX_HASH_ATTEMPTS = 5;

const uploadsDir = `${import.meta.dir}/../uploads`;

// A generous upper bound for a cropped PNG from the browser. $toCanvas()
// renders at the resolution of the source image, not at the crop zone size.
const MAX_UPLOAD_SIZE = 15 * 1024 * 1024;

// Extension for the stored file, so Bun can infer the Content-Type on
// serve. The public hash stays bare. See resolveUpload below. New uploads
// are PNG only. The other entries keep older uploads readable.
const EXTENSION_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/bmp": "bmp",
	"image/avif": "avif",
	"image/x-icon": "ico",
	"image/tiff": "tiff",
	"image/heic": "heic",
	"image/heif": "heif",
};

function log(...args: unknown[]) {
	console.log(`[${new Date().toISOString()}]`, ...args);
}

// Security headers for well-known web vulnerabilities. The HTML bundle
// routes '/' and '/*' do not get them. Bun exposes no documented way.
const securityHeaders = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Content-Security-Policy": "default-src 'self'",
};

function withSecurityHeaders(response: Response): Response {
	for (const [key, value] of Object.entries(securityHeaders)) {
		response.headers.set(key, value);
	}
	return response;
}

// Serves a file from `dir`, stripping `prefix` off the request path.
// `new URL().pathname` normalizes dot segments before the slice, so a `../`
// traversal fails. Do not switch to a raw `req.url` match without retesting.
function serveFrom(dir: string, prefix: string) {
	return async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
		const file = Bun.file(`${dir}/${url.pathname.slice(prefix.length)}`);
		const exists = await file.exists();
		log(exists ? "served" : "404", url.pathname);
		return withSecurityHeaders(
			exists ? new Response(file) : new Response("Not Found", { status: 404 }),
		);
	};
}

// Uploads sit on disk as `<hash>.<ext>` but are served from the bare hash.
// This loop stats a fixed set of names, so it stays O(1).
// Check `HASH_PATTERN` first: an unchecked hash could escape `uploadsDir`.
const HASH_PATTERN = /^[a-zA-Z0-9]+$/;
const KNOWN_EXTENSIONS = Object.values(EXTENSION_BY_MIME);
const KNOWN_SUFFIXES = ["", ...KNOWN_EXTENSIONS.map((ext) => `.${ext}`)];

async function resolveUpload(hash: string): Promise<string | undefined> {
	if (!HASH_PATTERN.test(hash)) return undefined;
	for (const suffix of KNOWN_SUFFIXES) {
		const path = `${uploadsDir}/${hash}${suffix}`;
		if (await Bun.file(path).exists()) return path;
	}
	return undefined;
}

// Older uploads have no extension, so Bun cannot infer their Content-Type.
// Only SVG needs the header; a browser sniffs raster formats itself. This
// runs for bare files only, a fixed and shrinking set.
const SVG_ROOT_TAG = /<svg[\s>]/i;

async function sniffLegacyContentType(
	file: ReturnType<typeof Bun.file>,
): Promise<string | undefined> {
	const head = await file
		.slice(0, 1024)
		.text()
		.catch(() => "");
	return SVG_ROOT_TAG.test(head) ? "image/svg+xml" : undefined;
}

const dogePath = `${import.meta.dir}/../client/public/img/doge.png`;

// A render is fast but not free. A single-slot lock is simpler than a job
// queue, because two exports rarely overlap. '/export-status' reads
// exportProgress (0-100) during a render, to show real progress.
let exportInProgress = false;
let exportProgress = 0;

const EXPORT_CONTENT_TYPE: Record<ExportFormat, string> = {
	mp4: "video/mp4",
	webm: "video/webm",
	gif: "image/gif",
};

const HASH_CHARS =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomHash(length: number): string {
	let hash = "";
	for (let i = 0; i < length; i++) {
		hash += HASH_CHARS[randomInt(HASH_CHARS.length)];
	}
	return hash;
}

// Generates a random upload hash. Retries on a name collision on disk.
// A small fixed retry cap is enough. See MAX_HASH_ATTEMPTS above.
async function generateUploadHash(): Promise<string> {
	let hash = "";
	for (let attempts = 0; attempts < MAX_HASH_ATTEMPTS; attempts++) {
		hash = randomHash(HASH_LENGTH);
		const collides = await Bun.file(`${uploadsDir}/${hash}.png`).exists();
		if (!collides) break;
	}
	return hash;
}

// The 8-byte PNG magic number. A raw POST can spoof the declared
// Content-Type, and the export renderer later reads the stored file with a
// native image decoder, so check the real bytes.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function hasPngSignature(file: Blob): Promise<boolean> {
	const header = new Uint8Array(
		await file.slice(0, PNG_SIGNATURE.length).arrayBuffer(),
	);
	return PNG_SIGNATURE.every((byte, i) => header[i] === byte);
}

function parseExportOptions(searchParams: URLSearchParams): {
	orientation: Orientation;
	format: ExportFormat;
	resolution: Resolution;
	fps: FrameRate;
} {
	const orientation =
		searchParams.get("orientation") === "portrait" ? "portrait" : "landscape";

	const rawFormat = searchParams.get("format");
	const format: ExportFormat = EXPORT_FORMATS.includes(
		rawFormat as ExportFormat,
	)
		? (rawFormat as ExportFormat)
		: DEFAULT_FORMAT;

	const rawResolution = searchParams.get("resolution");
	let resolution: Resolution = RESOLUTIONS.includes(rawResolution as Resolution)
		? (rawResolution as Resolution)
		: DEFAULT_RESOLUTION;

	const rawFps = Number(searchParams.get("fps"));
	let fps: FrameRate = FRAME_RATES.includes(rawFps as FrameRate)
		? (rawFps as FrameRate)
		: DEFAULT_FPS;

	// The server enforces this cap too. The disabled client buttons are not
	// enough. A direct request could otherwise pass the cap.
	if (format === "gif") {
		({ resolution, fps } = clampForGif(resolution, fps));
	}

	return { orientation, format, resolution, fps };
}

const server = Bun.serve({
	port: HTTP_PORT,
	// The Bun default of 10s is too short for '/export/*'. The server sends
	// one Response at the end and streams nothing, so the whole render
	// counts against this timeout. The slowest capped combination measured
	// about 13s. 60s leaves several times that margin. See CLAUDE.md for the
	// measured numbers behind the 720p cap and the GIF cap.
	idleTimeout: 60,
	routes: {
		"/": index,

		"/upload": {
			async POST(req) {
				const form = await req.formData();
				const file = form.get("file-upload");

				// PNG only: the client always re-encodes through a canvas
				// before an upload, so nothing else arrives here
				// legitimately. `file.type` is only what the client
				// declares, so this is a cheap early exit. The magic-byte
				// check below is what gates the disk.
				if (!(file instanceof Blob) || file.type !== "image/png") {
					log(
						"upload rejected: not a PNG",
						file instanceof Blob ? file.type : typeof file,
					);
					// The `error` query parameter lets the client show a
					// specific reason. The upload never fails silently.
					return withSecurityHeaders(
						Response.redirect("/?error=invalid_type", 303),
					);
				}

				if (file.size > MAX_UPLOAD_SIZE) {
					log("upload rejected: too large", `${file.size} bytes`);
					return withSecurityHeaders(
						Response.redirect("/?error=too_large", 303),
					);
				}

				if (!(await hasPngSignature(file))) {
					log("upload rejected: not a PNG (bad signature)");
					return withSecurityHeaders(
						Response.redirect("/?error=invalid_type", 303),
					);
				}

				const hash = await generateUploadHash();
				const storedName = `${hash}.png`;
				await Bun.write(`${uploadsDir}/${storedName}`, file);
				log("upload OK:", storedName, file.type, `${file.size} bytes`);
				return withSecurityHeaders(Response.redirect(`/${hash}`, 303));
			},
		},

		"/uploads/*": async (req) => {
			const url = new URL(req.url);
			const hash = url.pathname.slice("/uploads/".length);
			const path = await resolveUpload(hash);
			log(path ? "served" : "404", url.pathname);
			if (!path) {
				return withSecurityHeaders(new Response("Not Found", { status: 404 }));
			}

			const file = Bun.file(path);
			const response = new Response(file);
			if (path === `${uploadsDir}/${hash}`) {
				const sniffed = await sniffLegacyContentType(file);
				if (sniffed) response.headers.set("Content-Type", sniffed);
			}
			return withSecurityHeaders(response);
		},
		// script.ts names this path at runtime, as a plain string. The HTML
		// bundler cannot analyze it, so this route serves the folder.
		"/img/*": serveFrom(`${import.meta.dir}/../client/public/img`, "/img/"),
		// The HTML bundler processes <source src>. It does not process a
		// <track src> on the same <video>. The captions need their own route.
		"/videos/*": serveFrom(
			`${import.meta.dir}/../client/public/videos`,
			"/videos/",
		),

		"/export/*": async (req) => {
			const url = new URL(req.url);
			const hash = url.pathname.slice("/export/".length);
			const imagePath = hash ? await resolveUpload(hash) : dogePath;
			if (!imagePath) {
				return withSecurityHeaders(new Response("Not Found", { status: 404 }));
			}

			if (exportInProgress) {
				return withSecurityHeaders(
					new Response("An export is already in progress, try again shortly", {
						status: 429,
					}),
				);
			}

			const { orientation, format, resolution, fps } = parseExportOptions(
				url.searchParams,
			);

			exportInProgress = true;
			exportProgress = 0;
			const dir = await mkdtemp(join(tmpdir(), "shooting-stars-export-"));
			try {
				const outputPath = await renderExportInWorker(
					{ imagePath, orientation, resolution, fps, format, dir },
					(percent) => {
						exportProgress = percent;
					},
				);
				const bytes = await Bun.file(outputPath).arrayBuffer();
				log(
					"export OK:",
					hash || "(default)",
					orientation,
					resolution,
					`${fps}fps`,
					format,
					`${bytes.byteLength} bytes`,
				);
				// Named after the hash, or "doge" for the default image. A
				// fixed name would collide on disk across two exports.
				const filename = `${hash || "doge"}.${format}`;
				return withSecurityHeaders(
					new Response(bytes, {
						headers: {
							"Content-Type": EXPORT_CONTENT_TYPE[format],
							"Content-Disposition": `attachment; filename="${filename}"`,
						},
					}),
				);
			} catch (err) {
				log("export failed:", err);
				return withSecurityHeaders(
					new Response("Export failed", { status: 500 }),
				);
			} finally {
				exportInProgress = false;
				await rm(dir, { recursive: true, force: true });
			}
		},

		// The client polls this during an export, for real progress instead
		// of a bare spinner. It is a top-level path, not a child of
		// '/export/', so an upload that hashes to "status" cannot collide.
		"/export-status": () =>
			withSecurityHeaders(
				Response.json({
					inProgress: exportInProgress,
					percent: exportProgress,
				}),
			),

		// Any other path is an upload hash that the client routes. Serve the
		// same shell.
		"/*": index,
	},
	error(err) {
		log("unhandled error:", err);
		return withSecurityHeaders(
			new Response("Internal Server Error", { status: 500 }),
		);
	},
});

log(
	`Listening on port ${server.port} (NODE_ENV=${process.env.NODE_ENV || "development"})`,
);

export default server;
