import { afterAll, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import server from "../server/server.ts";

const uploadedHashes: string[] = [];

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
		// uploads used to accept any image/* type; the client now always
		// re-encodes to PNG before uploading (needed for the crop/
		// transparency-editing flow regardless of the source format), so
		// the server only accepts PNG going forward
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
			new Blob(["fake-png-bytes"], { type: "image/png" }),
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

		// the uploaded-hash path serves the same SPA shell as '/'
		const page = await fetch(new URL(location, server.url));
		expect(page.status).toBe(200);

		// and the actual uploaded file is stored and served back correctly
		const uploadedFile = await fetch(
			new URL(`/uploads${location}`, server.url),
		);
		expect(uploadedFile.status).toBe(200);
		expect(uploadedFile.headers.get("Content-Type")).toBe("image/png");
	});

	test("rejects a PNG-typed Blob uploaded under a non-.png filename", async () => {
		// the server derives the stored type from the filename extension, not
		// the Blob's own declared `type` — this is why the client always
		// uploads under a literal `cropped.png` filename rather than the
		// original file's name, which could carry any extension
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

	test("sniffs the right Content-Type for a legacy bare-file (no extension) SVG", async () => {
		const hash = "legacySvg";
		await Bun.write(
			`${import.meta.dir}/../uploads/${hash}`,
			'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
		);
		uploadedHashes.push(hash);

		const res = await fetch(new URL(`/uploads/${hash}`, server.url));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
	});

	test("serves a legacy non-PNG upload (from before the PNG-only restriction) by extension", async () => {
		const hash = "legacyJpeg";
		await Bun.write(
			`${import.meta.dir}/../uploads/${hash}.jpg`,
			"fake-jpeg-bytes",
		);
		uploadedHashes.push(`${hash}.jpg`);

		const res = await fetch(new URL(`/uploads/${hash}`, server.url));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/jpeg");
	});
});

describe("GET /img/*", () => {
	test("serves the default doge image", async () => {
		const res = await fetch(new URL("/img/doge.png", server.url));
		expect(res.status).toBe(200);
	});
});

describe("GET /videos/*", () => {
	test("serves the background video's captions file", async () => {
		const res = await fetch(new URL("/videos/background.vtt", server.url));
		expect(res.status).toBe(200);
	});
});
