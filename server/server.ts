import randomstring from 'randomstring';
import index from '../client/index.html';

// Fixed on purpose: the app always listens on 9595 inside the container (or
// on the host, if run directly with `bun server/server.ts`). Only the Docker
// host-side port mapping is configurable, via APP_PORT in docker-compose.yml.
const HTTP_PORT = 9595;
const HASH_LENGTH = parseInt(process.env.HASH_LENGTH || '5', 10); // hash length for uploaded images URL

const uploadsDir = `${import.meta.dir}/../uploads`;

// extension to store the upload under, so Bun can infer the right
// Content-Type when serving it back — the public URL/hash stays bare
// regardless (see resolveUpload below).
const EXTENSION_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
    'image/x-icon': 'ico',
};

function log(...args: unknown[]) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

// security headers for well-known web vulnerabilities. Not applied to the
// HTML-bundle routes ('/' and '/*' below) — Bun's HTML-import routing
// doesn't expose a documented way to attach headers to those.
const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
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
        log(exists ? 'served' : '404', url.pathname);
        return withSecurityHeaders(
            exists
                ? new Response(file)
                : new Response('Not Found', { status: 404 }),
        );
    };
}

// uploads are stored on disk as `<hash>.<ext>` (see '/upload' below) but
// served from the bare hash, so resolve the real filename via a glob.
// `HASH_PATTERN` must be checked before the glob runs: an unvalidated hash
// like `*` would otherwise match arbitrary files in `uploadsDir`, leaking
// other users' uploads.
const HASH_PATTERN = /^[a-zA-Z0-9]+$/;

async function resolveUpload(hash: string): Promise<string | undefined> {
    if (!HASH_PATTERN.test(hash)) return undefined;
    const glob = new Bun.Glob(`${hash}.*`);
    for await (const match of glob.scan({ cwd: uploadsDir })) {
        return `${uploadsDir}/${match}`;
    }
    const bare = `${uploadsDir}/${hash}`;
    return (await Bun.file(bare).exists()) ? bare : undefined;
}

const server = Bun.serve({
    port: HTTP_PORT,
    routes: {
        '/': index,

        '/upload': {
            async POST(req) {
                const form = await req.formData();
                const file = form.get('file-upload');

                if (!(file instanceof Blob) || !/^image\/.+$/.test(file.type)) {
                    log(
                        'upload rejected: not an image',
                        file instanceof Blob ? file.type : typeof file,
                    );
                    return withSecurityHeaders(Response.redirect('/', 303));
                }

                const hash = randomstring.generate(HASH_LENGTH);
                const ext = EXTENSION_BY_MIME[file.type];
                const storedName = ext ? `${hash}.${ext}` : hash;
                await Bun.write(`${uploadsDir}/${storedName}`, file);
                log('upload OK:', storedName, file.type, `${file.size} bytes`);
                return withSecurityHeaders(Response.redirect(`/${hash}`, 303));
            },
        },

        '/uploads/*': async (req) => {
            const url = new URL(req.url);
            const path = await resolveUpload(
                url.pathname.slice('/uploads/'.length),
            );
            log(path ? 'served' : '404', url.pathname);
            return withSecurityHeaders(
                path
                    ? new Response(Bun.file(path))
                    : new Response('Not Found', { status: 404 }),
            );
        },
        // script.ts references this dynamically at runtime (not statically
        // analyzable, so the HTML bundler can't pick it up) — serve it directly
        '/img/*': serveFrom(`${import.meta.dir}/../client/public/img`, '/img/'),

        // any other path is a client-side-routed uploaded-image hash: serve the same SPA shell
        '/*': index,
    },
    error(err) {
        log('unhandled error:', err);
        return withSecurityHeaders(
            new Response('Internal Server Error', { status: 500 }),
        );
    },
});

log(
    `Listening on port ${server.port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`,
);

export default server;
