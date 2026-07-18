import index from './index.html';
import randomstring from 'randomstring';

const NODE_ENV = process.env.NODE_ENV || 'prod';                // environment (dev/prod)
const HTTP_PORT = parseInt(process.env.HTTP_PORT || 9595);      // http port of the server
const HASH_LENGTH = parseInt(process.env.HASH_LENGTH || 5);     // hash length for uploaded images URL

const uploadsDir = `${import.meta.dir}/uploads`;

// security headers for well-known web vulnerabilities (skipped in dev, same
// reasoning as the previous Helmet setup: no value for a local-only server)
const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
};

function withSecurityHeaders(response) {
    if (NODE_ENV !== 'dev') {
        for (const [key, value] of Object.entries(securityHeaders)) {
            response.headers.set(key, value);
        }
    }
    return response;
}

// serves a file from `dir`, stripping `prefix` off the request path
function serveFrom(dir, prefix) {
    return async function(req) {
        const url = new URL(req.url);
        const file = Bun.file(`${dir}/${url.pathname.slice(prefix.length)}`);
        return withSecurityHeaders(
            (await file.exists()) ? new Response(file) : new Response('Not Found', { status: 404 })
        );
    };
}

Bun.serve({
    port: HTTP_PORT,
    development: NODE_ENV === 'dev' && { hmr: true },
    routes: {
        '/': index,

        '/upload': {
            async POST(req) {
                const form = await req.formData();
                const file = form.get('file-upload');

                if (!(file instanceof Blob) || !/^image\/.+$/.test(file.type)) {
                    console.log('error, file is not an image');
                    return withSecurityHeaders(Response.redirect('/', 303));
                }

                const filename = randomstring.generate(HASH_LENGTH);
                await Bun.write(`${uploadsDir}/${filename}`, file);
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
});

console.log('Listening on port ' + HTTP_PORT + ' with HTTP (' + NODE_ENV + ' mode)');
