import index from './index.html';
import randomstring from 'randomstring';

const HTTP_PORT = parseInt(process.env.HTTP_PORT || 9595);      // http port of the server
const HASH_LENGTH = parseInt(process.env.HASH_LENGTH || 5);     // hash length for uploaded images URL

const uploadsDir = `${import.meta.dir}/uploads`;

function log(...args) {
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

function withSecurityHeaders(response) {
    for (const [key, value] of Object.entries(securityHeaders)) {
        response.headers.set(key, value);
    }
    return response;
}

// serves a file from `dir`, stripping `prefix` off the request path
function serveFrom(dir, prefix) {
    return async function(req) {
        const url = new URL(req.url);
        const file = Bun.file(`${dir}/${url.pathname.slice(prefix.length)}`);
        const exists = await file.exists();
        log(exists ? 'served' : '404', url.pathname);
        return withSecurityHeaders(
            exists ? new Response(file) : new Response('Not Found', { status: 404 })
        );
    };
}

Bun.serve({
    port: HTTP_PORT,
    routes: {
        '/': index,

        '/upload': {
            async POST(req) {
                const form = await req.formData();
                const file = form.get('file-upload');

                if (!(file instanceof Blob) || !/^image\/.+$/.test(file.type)) {
                    log('upload rejected: not an image', file?.type);
                    return withSecurityHeaders(Response.redirect('/', 303));
                }

                const filename = randomstring.generate(HASH_LENGTH);
                await Bun.write(`${uploadsDir}/${filename}`, file);
                log('upload OK:', filename, file.type, `${file.size} bytes`);
                return withSecurityHeaders(Response.redirect(`/${filename}`, 303));
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
        return withSecurityHeaders(new Response('Internal Server Error', { status: 500 }));
    },
});

log(`Listening on port ${HTTP_PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
