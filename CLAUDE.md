# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page site that recreates the "shooting stars" meme: a background video plays, and up to 6 images (uploaded by the user, or the default doge image) fly across the screen in sync with hardcoded animation keyframes. No frontend framework, build tooling is Vite (LESS→CSS, JS bundling/minification), no database — uploaded files on disk are the only state.

## Commands

Docker (preferred workflow, via `just`):
```sh
just build       # docker compose build
just start       # docker compose up -d       (production: serves the pre-built dist/)
just dev         # docker compose --profile dev up node-dev  (live HMR via Vite middleware)
just up          # build + start
just shell       # shell into the node container
just down        # stop + remove containers (keeps volumes)
just down_clean  # stop + remove containers AND volumes
just lock        # regenerate package-lock.json inside the container
```

There is no test suite (`npm test` is a stub) and no linter configured.

## Architecture

- **`server.js`** — the entire backend. A single Express app that:
  - handles `POST /upload` via multer: saves the uploaded image to `uploads/` under a random filename (`randomstring`, length controlled by `HASH_LENGTH` env var), then redirects to `/<hash>`
  - serves `/uploads` as static files (same in dev and prod — uploads are runtime data, not part of the Vite build)
  - in `NODE_ENV=dev`, creates a Vite dev server in **middleware mode** (`vite.middlewares`) and serves `index.html` transformed via `vite.transformIndexHtml()` on every other route — this gives on-the-fly LESS/JS compilation with HMR. The HMR websocket is attached to the same `http.Server`/port (`hmr: { server: httpServer }`) so no extra port needs exposing. Helmet is skipped in dev because its CSP blocks the HMR websocket.
  - in prod, serves the pre-built `dist/` (produced by `vite build`) statically, catch-all (`GET /{*splat}`) returns `dist/index.html` — the hash from the URL is read client-side, not routed server-side.

- **`index.html`** (project root, Vite's entry point) — links `src/style.less` and `src/script.js` directly; Vite rewrites these to hashed built assets in `dist/` on production build.

- **`src/script.js`** — all client logic, no bundler-specific APIs beyond being loaded as an ES module (`type="module"`). Reads the current URL path: if it's `/` shows `img/doge.png`, otherwise treats the path as an uploaded image hash and points all 6 `<img>` elements at `uploads/<hash>`. The `times` map in `startAnimation()` is the choreography table: keys are millisecond offsets, values say which CSS class each picture should have at that offset (driven by `setTimeout`, not `requestAnimationFrame`). This map's timings must line up with `videos/background.mp4`'s runtime and with the animation durations defined in LESS.

- **`src/style.less`** — the actual animation, expressed as CSS `@keyframes` per stage (`init`, `spaceone`, `dolphins`, `spacetwo`, `microone`, `microtwo`). Each stage has per-picture keyframe variants (e.g. `spacetwo_1` through `spacetwo_6`) with different transform/timing so images don't move identically. Changing an animation's duration here means updating the matching offset(s) in `script.js`'s `times` map too — they are not derived from each other. Vite compiles `.less` natively (via the installed `less` package, no plugin needed).

- **`public/`** — Vite's `publicDir`: `img/` (including the default `doge.png`) and `videos/background.mp4`, copied as-is into `dist/` on build and served directly by Vite/Express otherwise.

- **`uploads/`** — runtime-written, gitignored, lives at the project root (outside `public/`/Vite's build pipeline, since `vite build` wipes and repopulates `dist/` from `publicDir` on every run — runtime uploads would be lost if they lived there). In Docker this is a bind-mounted volume (`/opt/tekrop/shooting-stars/uploads` on the host per `docker-compose.yml`) so uploads survive container recreation. `clean_old_uploads.sh` (meant to run via host cron, not inside the container) deletes uploaded files older than 30 days from a hardcoded path.

- **`Dockerfile`** — multi-stage: a `deps` stage installs full `npm ci` (used as-is by the `dev` target, which runs `server.js` with `NODE_ENV=dev` against bind-mounted source for live HMR); a `build` stage runs `vite build`; the final untargeted stage installs prod-only deps and copies in `dist/` from the `build` stage.

- **`docker-compose.yml`** — two services: `node` (default profile, production, builds the final stage) and `node-dev` (profile `dev`, builds the `dev` Dockerfile target, bind-mounts `server.js`/`vite.config.js`/`index.html`/`src/`/`public/` for live editing).

## Notes

- `helmet` + `compression` + `morgan` are applied globally in `server.js` (helmet only in prod, see above); any new route added there inherits them for free.
- The upload filter only checks MIME type (`image/*`), not file contents or extension.
- Port is `9595` by default (`HTTP_PORT` env var), and in the current compose setup is bound to localhost only.
