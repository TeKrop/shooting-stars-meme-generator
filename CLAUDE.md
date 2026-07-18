# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page site that recreates the "shooting stars" meme: a background video plays, and up to 6 images (uploaded by the user, or the default doge image) fly across the screen in sync with hardcoded animation keyframes. No frontend framework, runtime/build tooling is Bun (native CSS/JS bundling, dev-mode HMR, HTTP server), no database — uploaded files on disk are the only state.

## Commands

Docker (preferred workflow, via `just`):
```sh
just build       # docker compose build
just start       # docker compose up -d       (production: bun server.js, bundles/minifies/caches lazily at runtime)
just dev         # docker compose --profile dev up bun-dev  (live HMR via `bun --hot`)
just up          # build + start
just shell       # shell into the bun container
just down        # stop + remove containers (keeps volumes)
just down_clean  # stop + remove containers AND volumes
just lock        # regenerate bun.lock inside the container
```

There is no test suite (`npm test` is a stub) and no linter configured.

## Configuration

Copy `.env.dist` to `.env` to override `HTTP_PORT`/`HASH_LENGTH` (picked up by
`docker-compose.yml`'s `env_file:`, optional so a missing `.env` still works
with `server.js`'s built-in defaults). `NODE_ENV` is deliberately NOT in
`.env` — it's fixed per Docker target (`development` for `dev`, `production`
for the prod stage) in the `Dockerfile`, since it controls which Bun.serve
bundling mode runs (see below), not something to toggle per deployment.

## Architecture

- **`server.js`** — the entire backend, built around `Bun.serve()`:
  - `import index from './index.html'` — Bun's HTML-import bundling parses `index.html`, discovers its linked `src/style.css`/`src/script.js`/bundled assets, and bundles them. Whether this happens in dev mode (on-demand, unminified, HMR) or production mode (minified, cached, hashed filenames) is decided by Bun itself purely from the `NODE_ENV` env var (`production` → prod bundling, anything else → dev bundling) — `server.js` has no explicit dev/prod branching of its own for this.
  - `routes` table: `'/'` and the wildcard `'/*'` both serve the `index` HTML bundle (the wildcard is the SPA-style fallback for an uploaded-image hash path like `/abc12` — the hash is read client-side from `location.pathname`, not routed server-side). These two routes can't be wrapped for logging: Bun's HTML-bundle value can only be returned by direct assignment (`'/': index`), not from inside a route handler function — returning it from a function silently produces a bogus placeholder response instead (tested against Bun 1.3.14). Every other route is a plain function and does get logged.
  - `'/upload'` has a `POST` handler that reads the file via `req.formData()` (native multipart parsing, no `multer`) and writes it to `uploads/` via `Bun.write()` under a `randomstring`-generated name (length controlled by `HASH_LENGTH` env var), then redirects to `/<hash>`.
  - `'/uploads/*'` serves files from `uploads/` via `Bun.file()`. `'/img/*'` similarly serves `public/img/` — needed because `script.js` references `img/doge.png` dynamically at runtime (a plain string, not statically analyzable), so the HTML bundler can't pick it up the way it does the video/CSS/JS.
  - A few security response headers (`X-Content-Type-Options`, `X-Frame-Options`, a basic CSP) are set on every response we build ourselves — no `helmet` dependency needed for this. Not applied to the HTML-bundle routes (`'/'`/`'/*'`) since Bun's HTML-import routing doesn't expose a documented way to attach custom headers to those.
  - `log()` is a tiny timestamped `console.log` wrapper used for startup info, every upload attempt (success with filename/type/size, or rejection reason), every static file serve/404 under `/uploads/*` and `/img/*`, and uncaught errors (via Bun.serve's `error` hook). The two HTML-bundle routes are the one place that can't be logged per-request, per the limitation above.
  - Bun loads `.env` files natively — no `dotenv`.

- **`index.html`** (project root, Bun's HTML-import entry point) — links `src/style.css` and `src/script.js` via plain relative paths, and the background video via `./public/videos/background.mp4` (a real relative path so Bun's bundler picks it up, copies it, and rewrites the URL — referencing it as `/videos/background.mp4` instead makes the bundler try and fail to resolve it as a module). The favicon `<link>` is the one asset-looking tag Bun's bundler does NOT process at all, so it keeps a plain `/img/favicon.png` server-relative href, served by the `/img/*` route.

- **`src/script.js`** — all client logic, no bundler-specific APIs beyond being loaded as an ES module (`type="module"`). Reads the current URL path: if it's `/` shows `img/doge.png`, otherwise treats the path as an uploaded image hash and points all 6 `<img>` elements at `uploads/<hash>`. The `times` map in `startAnimation()` is the choreography table: keys are millisecond offsets, values say which CSS class each picture should have at that offset (driven by `setTimeout`, not `requestAnimationFrame`). This map's timings must line up with `videos/background.mp4`'s runtime and with the animation durations defined in the CSS.

- **`src/style.css`** — the actual animation, expressed as native CSS `@keyframes` per stage (`init`, `spaceone`, `dolphins`, `spacetwo`, `microone`, `microtwo`). Each stage has per-picture keyframe variants (e.g. `spacetwo_1` through `spacetwo_6`) with different transform/timing so images don't move identically. Changing an animation's duration here means updating the matching offset(s) in `script.js`'s `times` map too — they are not derived from each other. Uses native CSS nesting (`&:hover`, `&.hide`) — Bun's bundler (Lightning CSS) supports this directly, no preprocessor needed. Was originally LESS; converted to plain CSS since Bun's bundler doesn't support LESS and the only genuinely LESS-specific features in the file were a few `@variable`-based compile-time arithmetic values in the `init` keyframes, now inlined as literals.

- **`public/img/doge.png`** — the only asset still served through a manual route rather than the HTML bundler, since it's referenced dynamically (see `script.js` above).

- **`uploads/`** — runtime-written, gitignored, lives at the project root. In Docker this is a bind-mounted volume (`/opt/tekrop/shooting-stars/uploads` on the host per `docker-compose.yml`) so uploads survive container recreation. `clean_old_uploads.sh` (meant to run via host cron, not inside the container) deletes uploaded files older than 30 days from a hardcoded path.

- **`Dockerfile`** — based on `oven/bun:1-alpine`, working directory `/app`. A `deps` stage runs `bun install --frozen-lockfile` (shared by both targets — there's no dev/prod dependency split since the only dependency is `randomstring`); a `dev` target runs `bun --hot server.js` against bind-mounted source for live HMR; the final untargeted stage copies the source in and runs `bun server.js` with `NODE_ENV=production` (bundling/minification happens lazily at runtime, no build stage or `dist/` artifact needed).

- **`docker-compose.yml`** — two services: `bun` (default profile, production) and `bun-dev` (profile `dev`, builds the `dev` Dockerfile target, bind-mounts `server.js`/`index.html`/`src/`/`public/` for live editing). Both load `./.env` if present (see Configuration above).

## Notes

- The upload filter only checks MIME type (`image/*`), not file contents or extension.
- Port is `9595` by default (`HTTP_PORT` env var), and in the current compose setup is bound to localhost only.
