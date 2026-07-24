import { afterAll, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import server from "../server/server.ts";

const uploadedHashes: string[] = [];

// The real 8-byte PNG magic number, so a test Blob passes the content check
// of the server whatever bytes follow it.
const PNG_SIGNATURE = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// For tests that need a real hash to export by. It uploads the true doge.png
// bytes, because an export decodes the file with loadImage() and the
// placeholder PNG of the plain upload tests fails there.
async function uploadTestImage(): Promise<string> {
	const dogeBytes = await Bun.file(
		`${import.meta.dir}/../client/public/img/doge.png`,
	).arrayBuffer();
	const form = new FormData();
	form.set(
		"file-upload",
		new Blob([dogeBytes], { type: "image/png" }),
		"test.png",
	);
	const res = await fetch(new URL("/upload", server.url), {
		method: "POST",
		body: form,
		redirect: "manual",
	});
	const hash = (res.headers.get("location") as string).slice(1);
	uploadedHashes.push(`${hash}.png`);
	return hash;
}

afterAll(async () => {
	server.stop();
	await Promise.all(
		uploadedHashes.map((hash) =>
			unlink(`${import.meta.dir}/../uploads/${hash}`).catch(() => {}),
		),
	);
});

describe("GET /", () => {
	test("serves the page", async () => {
		const res = await fetch(new URL("/", server.url));
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("<html");
	});
});

describe("POST /upload", () => {
	test("rejects a non-image upload", async () => {
		const form = new FormData();
		form.set(
			"file-upload",
			new Blob(["hello"], { type: "text/plain" }),
			"hello.txt",
		);

		const res = await fetch(new URL("/upload", server.url), {
			method: "POST",
			body: form,
			redirect: "manual",
		});

		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/?error=invalid_type");
	});

	test("rejects a non-PNG image upload", async () => {
		// Uploads accepted any image/* type before. The client now always
		// re-encodes to PNG for the crop and transparency steps, so the
		// server accepts PNG only.
		const form = new FormData();
		form.set(
			"file-upload",
			new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], {
				type: "image/svg+xml",
			}),
			"test.svg",
		);

		const res = await fetch(new URL("/upload", server.url), {
			method: "POST",
			body: form,
			redirect: "manual",
		});

		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/?error=invalid_type");
	});

	test("accepts a PNG upload and redirects to a hash URL", async () => {
		const form = new FormData();
		form.set(
			"file-upload",
			new Blob([PNG_SIGNATURE, "fake-png-bytes"], { type: "image/png" }),
			"test.png",
		);

		const res = await fetch(new URL("/upload", server.url), {
			method: "POST",
			body: form,
			redirect: "manual",
		});

		expect(res.status).toBe(303);
		const location = res.headers.get("location") as string;
		expect(location).toMatch(/^\/\w{5}$/);
		uploadedHashes.push(`${location.slice(1)}.png`);

		// The upload hash path serves the same shell as '/'.
		const page = await fetch(new URL(location, server.url));
		expect(page.status).toBe(200);

		// The server also stores the uploaded file. It serves it back
		// correctly.
		const uploadedFile = await fetch(
			new URL(`/uploads${location}`, server.url),
		);
		expect(uploadedFile.status).toBe(200);
		expect(uploadedFile.headers.get("Content-Type")).toBe("image/png");
	});

	test("rejects a PNG-typed Blob uploaded under a non-.png filename", async () => {
		// The stored type comes from the filename extension, not the declared
		// `type` of the Blob. This is why the client always uploads under the
		// literal name `cropped.png`.
		const form = new FormData();
		form.set(
			"file-upload",
			new Blob(["fake-png-bytes"], { type: "image/png" }),
			"photo.jpg",
		);

		const res = await fetch(new URL("/upload", server.url), {
			method: "POST",
			body: form,
			redirect: "manual",
		});

		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/?error=invalid_type");
	});

	test("rejects a spoofed Content-Type whose bytes aren't actually a PNG", async () => {
		// A raw client can declare `image/png` on the multipart part, whatever
		// the real bytes hold. The server must therefore check the file
		// content. It must not trust the declared type.
		const form = new FormData();
		form.set(
			"file-upload",
			new Blob(["not-a-real-png"], { type: "image/png" }),
			"test.png",
		);

		const res = await fetch(new URL("/upload", server.url), {
			method: "POST",
			body: form,
			redirect: "manual",
		});

		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/?error=invalid_type");
	});

	test("rejects an upload over the size limit", async () => {
		const form = new FormData();
		form.set(
			"file-upload",
			new Blob([new Uint8Array(15 * 1024 * 1024 + 1)], {
				type: "image/png",
			}),
			"big.png",
		);

		const res = await fetch(new URL("/upload", server.url), {
			method: "POST",
			body: form,
			redirect: "manual",
		});

		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/?error=too_large");
	});
});

describe("GET /uploads/*", () => {
	test("returns 404 for a file that was never uploaded", async () => {
		const res = await fetch(new URL("/uploads/does-not-exist", server.url));
		expect(res.status).toBe(404);
	});

	test("sets security headers on the response", async () => {
		const res = await fetch(new URL("/uploads/does-not-exist", server.url));
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
		expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
	});

	test("rejects a glob-metacharacter hash instead of leaking a file", async () => {
		const res = await fetch(new URL("/uploads/%2A", server.url));
		expect(res.status).toBe(404);
	});
});

describe("GET /img/*", () => {
	test("serves the default doge image", async () => {
		const res = await fetch(new URL("/img/doge.png", server.url));
		expect(res.status).toBe(200);
	});
});

describe("GET /export/*", () => {
	test("returns 404 for a hash that was never uploaded, without rendering anything", async () => {
		const res = await fetch(new URL("/export/does-not-exist", server.url));
		expect(res.status).toBe(404);
	});

	// A real end-to-end render with the default doge image. It mocks out
	// neither ffmpeg nor the canvas: finishing in seconds, against about 25s
	// for the old Playwright approach, is the point of the feature.
	test("renders the default doge animation as a real MP4 export", async () => {
		const res = await fetch(
			new URL("/export/?orientation=landscape", server.url),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("video/mp4");
		// The name is "doge", not a generic "shooting-stars", because the
		// request gave no hash. Two exports therefore never overwrite each
		// other on disk.
		expect(res.headers.get("Content-Disposition")).toBe(
			'attachment; filename="doge.mp4"',
		);
		const bytes = await res.arrayBuffer();
		expect(bytes.byteLength).toBeGreaterThan(1000);
	}, 30_000);

	// WebM re-encodes video as VP8 and audio as Vorbis, because it cannot
	// carry the AAC track that MP4 copies. It is therefore slower than the
	// case above, but still well inside the timeout.
	test("renders the default doge animation as a real WebM export", async () => {
		const res = await fetch(
			new URL("/export/?orientation=landscape&format=webm", server.url),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("video/webm");
		const bytes = await res.arrayBuffer();
		expect(bytes.byteLength).toBeGreaterThan(1000);
	}, 30_000);

	test("defaults to MP4 for an unrecognized format value", async () => {
		const res = await fetch(
			new URL("/export/?format=not-a-real-format", server.url),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("video/mp4");
	}, 30_000);

	test("defaults to 480p/24fps for unrecognized resolution/fps values", async () => {
		const res = await fetch(
			new URL(
				"/export/?resolution=not-a-real-resolution&fps=not-a-real-fps",
				server.url,
			),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("video/mp4");
	}, 30_000);

	// A tier below the default is enough here. It proves that the server
	// passes the resolution parameter through. A larger tier only runs
	// slower.
	test("renders at a non-default resolution tier", async () => {
		const res = await fetch(new URL("/export/?resolution=360p", server.url));
		expect(res.status).toBe(200);
		const bytes = await res.arrayBuffer();
		expect(bytes.byteLength).toBeGreaterThan(1000);
	}, 30_000);

	// GIF adds a palettegen and paletteuse pass on top of the same
	// compositing work, so it is the slowest of the three. Generous timeout.
	test("renders the default doge animation as a real GIF export", async () => {
		const res = await fetch(
			new URL("/export/?orientation=landscape&format=gif", server.url),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/gif");
		expect(res.headers.get("Content-Disposition")).toBe(
			'attachment; filename="doge.gif"',
		);
		const bytes = await res.arrayBuffer();
		expect(bytes.byteLength).toBeGreaterThan(1000);
	}, 60_000);

	// clampForGif() moves a GIF request above 480p24 back down instead of
	// rendering it as sent. An uncapped GIF at 1080p60 measured about 146s
	// and 324MB, so a 720p60 request must still come back quickly.
	test("clamps GIF resolution/fps down from an oversized request", async () => {
		const start = Date.now();
		const res = await fetch(
			new URL("/export/?resolution=720p&fps=60&format=gif", server.url),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/gif");
		expect(Date.now() - start).toBeLessThan(60_000);
	}, 60_000);

	// Covers the hash-based naming path; the "doge" case above covers the
	// no-hash fallback. One format is enough, since the filename code does
	// not branch on format.
	test("uses the upload's hash as the exported filename", async () => {
		const hash = await uploadTestImage();

		const res = await fetch(
			new URL(`/export/${hash}?orientation=landscape`, server.url),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Disposition")).toBe(
			`attachment; filename="${hash}.mp4"`,
		);
	}, 30_000);

	// exportInProgress is a real single-slot lock, not a mock, so two renders
	// at once reach the 429 branch. Polling /export-status instead of sleeping
	// proves the lock is held before the second request goes out.
	test("rejects a second concurrent export with 429", async () => {
		const first = fetch(new URL("/export/?orientation=landscape", server.url));
		while (true) {
			const status = await fetch(new URL("/export-status", server.url));
			if ((await status.json()).inProgress) break;
		}
		const second = await fetch(
			new URL("/export/?orientation=portrait", server.url),
		);
		expect(second.status).toBe(429);
		await first;
	}, 30_000);
});

describe("GET /export-status", () => {
	test("reports not in progress when idle", async () => {
		const res = await fetch(new URL("/export-status", server.url));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.inProgress).toBe(false);
	});

	test("reports progress while an export is running", async () => {
		const exportPromise = fetch(
			new URL("/export/?orientation=portrait", server.url),
		);
		// Gives the render loop time to produce its first frames.
		await new Promise((resolve) => setTimeout(resolve, 300));
		const statusRes = await fetch(new URL("/export-status", server.url));
		const status = await statusRes.json();
		expect(status.inProgress).toBe(true);
		expect(status.percent).toBeGreaterThan(0);
		await exportPromise;
	}, 30_000);
});

describe("GET /videos/*", () => {
	test("serves the background video's captions file", async () => {
		const res = await fetch(new URL("/videos/background.vtt", server.url));
		expect(res.status).toBe(200);
	});
});
