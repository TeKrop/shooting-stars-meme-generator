import { afterAll, describe, expect, test } from 'bun:test';
import { unlink } from 'node:fs/promises';
import server from '../server/server.ts';

const uploadedHashes: string[] = [];

afterAll(async () => {
    server.stop();
    await Promise.all(
        uploadedHashes.map((hash) =>
            unlink(`${import.meta.dir}/../uploads/${hash}`).catch(() => {}),
        ),
    );
});

describe('GET /', () => {
    test('serves the page', async () => {
        const res = await fetch(new URL('/', server.url));
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('<html');
    });
});

describe('POST /upload', () => {
    test('rejects a non-image upload', async () => {
        const form = new FormData();
        form.set(
            'file-upload',
            new Blob(['hello'], { type: 'text/plain' }),
            'hello.txt',
        );

        const res = await fetch(new URL('/upload', server.url), {
            method: 'POST',
            body: form,
            redirect: 'manual',
        });

        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe('/');
    });

    test('accepts an image upload and redirects to a hash URL', async () => {
        const form = new FormData();
        form.set(
            'file-upload',
            new Blob(['fake-png-bytes'], { type: 'image/png' }),
            'test.png',
        );

        const res = await fetch(new URL('/upload', server.url), {
            method: 'POST',
            body: form,
            redirect: 'manual',
        });

        expect(res.status).toBe(303);
        const location = res.headers.get('location')!;
        expect(location).toMatch(/^\/\w{5}$/);
        uploadedHashes.push(`${location.slice(1)}.png`);

        // the uploaded-hash path serves the same SPA shell as '/'
        const page = await fetch(new URL(location, server.url));
        expect(page.status).toBe(200);
    });

    test('stores an SVG upload with the right Content-Type on serve', async () => {
        const form = new FormData();
        form.set(
            'file-upload',
            new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], {
                type: 'image/svg+xml',
            }),
            'test.svg',
        );

        const res = await fetch(new URL('/upload', server.url), {
            method: 'POST',
            body: form,
            redirect: 'manual',
        });

        expect(res.status).toBe(303);
        const location = res.headers.get('location')!;
        expect(location).toMatch(/^\/\w{5}$/);
        const hash = location.slice(1);
        uploadedHashes.push(`${hash}.svg`);

        const served = await fetch(new URL(`/uploads${location}`, server.url));
        expect(served.status).toBe(200);
        expect(served.headers.get('Content-Type')).toBe('image/svg+xml');
    });
});

describe('GET /uploads/*', () => {
    test('returns 404 for a file that was never uploaded', async () => {
        const res = await fetch(new URL('/uploads/does-not-exist', server.url));
        expect(res.status).toBe(404);
    });

    test('sets security headers on the response', async () => {
        const res = await fetch(new URL('/uploads/does-not-exist', server.url));
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
        expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
    });

    test('rejects a glob-metacharacter hash instead of leaking a file', async () => {
        const res = await fetch(new URL('/uploads/%2A', server.url));
        expect(res.status).toBe(404);
    });

    test('sniffs the right Content-Type for a legacy bare-file (no extension) SVG', async () => {
        const hash = 'legacySvg';
        await Bun.write(
            `${import.meta.dir}/../uploads/${hash}`,
            '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        );
        uploadedHashes.push(hash);

        const res = await fetch(new URL(`/uploads/${hash}`, server.url));
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    });
});

describe('GET /img/*', () => {
    test('serves the default doge image', async () => {
        const res = await fetch(new URL('/img/doge.png', server.url));
        expect(res.status).toBe(200);
    });
});
