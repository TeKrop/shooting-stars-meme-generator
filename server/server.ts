import randomstring from "randomstring";
import index from "../client/index.html";

// Fixed on purpose: the app always listens on 9595 inside the container (or
// on the host, if run directly with `bun server/server.ts`). Only the Docker
// host-side port mapping is configurable, via APP_PORT in docker-compose.yml.
const HTTP_PORT = 9595;
const HASH_LENGTH = parseInt(process.env.HASH_LENGTH || "5", 10); // hash length for uploaded images URL

const uploadsDir = `${import.meta.dir}/../uploads`;

// generous for a cropped/edited PNG out of the browser (the crop zone tops
// out around 800x700 CSS px, but $toCanvas() renders at source-image
// resolution, so a large original photo can still produce a large PNG) —
// just a sane upper bound, not a tight fit
const MAX_UPLOAD_SIZE = 15 * 1024 * 1024;

// extension to store the upload under, so Bun can infer the right
// Content-Type when serving it back — the public URL/hash stays bare
// regardless (see resolveUpload below). New uploads are PNG-only (see
// '/upload' below, which always re-encodes client-side before sending) —
// the rest of this map exists purely so uploads from before that
// restriction still resolve/serve correctly (see KNOWN_SUFFIXES).
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

// security headers for well-known web vulnerabilities. Not applied to the
// HTML-bundle routes ('/' and '/*' below) — Bun's HTML-import routing
// doesn't expose a documented way to attach headers to those.
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

// serves a file from `dir`, stripping `prefix` off the request path.
// Safe against `../` traversal (tested with plain, percent-encoded, and
// double-encoded variants) because `new URL().pathname` normalizes dot
// segments per the WHATWG URL spec before we ever slice it — don't replace
// this with raw `req.url` string matching without re-verifying that.
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

// uploads are stored on disk as `<hash>.<ext>` (see '/upload' below) but
// served from the bare hash, so resolve the real filename by checking the
// handful of extensions we actually write (plus the bare name, for the
// unrecognized-MIME-type fallback in '/upload') — a fixed set of direct
// stats, not a directory scan, so this stays O(1) regardless of how many
// files are in `uploadsDir`.
// `HASH_PATTERN` must be checked first: an unvalidated hash could otherwise
// contain '../' and escape `uploadsDir`.
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

// pre-fix uploads were stored bare (no extension), so Bun can't infer their
// Content-Type on serve — peek at the bytes to at least recognize SVGs,
// since that's the one format browsers refuse to render inline without the
// correct header (raster formats already get rendered via the browser's own
// sniffing regardless of Content-Type). Only called for bare files, which
// is a fixed, shrinking set — not on every request.
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

const server = Bun.serve({
	port: HTTP_PORT,
	routes: {
		"/": index,

		"/upload": {
			async POST(req) {
				const form = await req.formData();
				const file = form.get("file-upload");

				// PNG-only: the client always crops/re-encodes through canvas
				// before uploading (needed for the transparency-editing
				// feature regardless of the original file's format), so
				// there's no legitimate case where anything else arrives here
				if (!(file instanceof Blob) || file.type !== "image/png") {
					log(
						"upload rejected: not a PNG",
						file instanceof Blob ? file.type : typeof file,
					);
					// the `error` query param lets the client show a
					// specific reason instead of just failing silently
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

				const hash = randomstring.generate(HASH_LENGTH);
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
		// script.ts references this dynamically at runtime (not statically
		// analyzable, so the HTML bundler can't pick it up) — serve it directly
		"/img/*": serveFrom(`${import.meta.dir}/../client/public/img`, "/img/"),
		// the HTML bundler doesn't process <track src> the way it does <source
		// src> on the same <video>, so the captions file needs its own static route
		"/videos/*": serveFrom(
			`${import.meta.dir}/../client/public/videos`,
			"/videos/",
		),

		// any other path is a client-side-routed uploaded-image hash: serve the same SPA shell
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
