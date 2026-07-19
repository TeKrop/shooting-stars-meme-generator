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
        uploadedHashes.push(location.slice(1));

        // the uploaded-hash path serves the same SPA shell as '/'
        const page = await fetch(new URL(location, server.url));
        expect(page.status).toBe(200);
    });
});

describe('GET /uploads/*', () => {
    test('returns 404 for a file that was never uploaded', async () => {
        const res = await fetch(new URL('/uploads/does-not-exist', server.url));
        expect(res.status).toBe(404);
    });
});
