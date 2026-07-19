import randomstring from 'randomstring';
import index from './index.html';

// Fixed on purpose: the app always listens on 9595 inside the container (or
// on the host, if run directly with `bun server.ts`). Only the Docker host-side
// port mapping is configurable, via APP_PORT in docker-compose.yml.
const HTTP_PORT = 9595;
const HASH_LENGTH = parseInt(process.env.HASH_LENGTH || '5', 10); // hash length for uploaded images URL

const uploadsDir = `${import.meta.dir}/uploads`;

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

// serves a file from `dir`, stripping `prefix` off the request path
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

                const filename = randomstring.generate(HASH_LENGTH);
                await Bun.write(`${uploadsDir}/${filename}`, file);
                log('upload OK:', filename, file.type, `${file.size} bytes`);
                return withSecurityHeaders(
                    Response.redirect(`/${filename}`, 303),
                );
            },
        },

        '/uploads/*': serveFrom(uploadsDir, '/uploads/'),
        // script.js references this dynamically at runtime (not statically
        // analyzable, so the HTML bundler can't pick it up) — serve it directly
        '/img/*': serveFrom(`${import.meta.dir}/public/img`, '/img/'),

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
