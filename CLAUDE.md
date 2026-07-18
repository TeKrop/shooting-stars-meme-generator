# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page site that recreates the "shooting stars" meme: a background video plays, and up to 6 images (uploaded by the user, or the default doge image) fly across the screen in sync with hardcoded animation keyframes. No frontend framework, no build system beyond LESS→CSS and JS minification, no database — uploaded files on disk are the only state.

## Commands

Local (no Docker):
```sh
npm install
node server.js          # NODE_ENV defaults to 'prod'
NODE_ENV=dev node server.js   # enables LESS/JS watch+minify on file change (needs `lessc` on PATH)
```

Docker (preferred workflow, via `just`):
```sh
just build       # docker compose build
just start       # docker compose up -d
just up          # build + start
just shell       # shell into the node container
just down        # stop + remove containers (keeps volumes)
just down_clean  # stop + remove containers AND volumes
just lock        # regenerate package-lock.json inside the container
```

There is no test suite (`npm test` is a stub) and no linter configured.

## Architecture

- **`server.js`** — the entire backend. A single Express app that:
  - serves `public/` statically
  - handles `POST /upload` via multer: saves the uploaded image to `public/uploads/` under a random filename (`randomstring`, length controlled by `HASH_LENGTH` env var), then redirects to `/<hash>`
  - catches all other routes (`GET /{*splat}`) and always returns `public/index.html` — the hash from the URL is read client-side, not routed server-side
  - in `NODE_ENV=dev`, uses `node-watch` to recompile `public/less/style.less` → `public/css/style.min.css` (via `lessc` + yui) and `public/js/script.js` → `public/js/script.min.js` (via uglify-js) on change. In prod, only the pre-built `.min.css`/`.min.js` are served — editing `style.less` or `script.js` directly requires the dev watcher (or manual `lessc`/uglify) to take effect.

- **`public/js/script.js`** — all client logic, no bundler/modules. Reads the current URL path: if it's `/` shows `img/doge.png`, otherwise treats the path as an uploaded image hash and points all 6 `<img>` elements at `uploads/<hash>`. The `times` map in `startAnimation()` is the choreography table: keys are millisecond offsets, values say which CSS class each picture should have at that offset (driven by `setTimeout`, not `requestAnimationFrame`). This map's timings must line up with `videos/background.mp4`'s runtime and with the animation durations defined in LESS.

- **`public/less/style.less`** — the actual animation, expressed as CSS `@keyframes` per stage (`init`, `spaceone`, `dolphins`, `spacetwo`, `microone`, `microtwo`). Each stage has per-picture keyframe variants (e.g. `spacetwo_1` through `spacetwo_6`) with different transform/timing so images don't move identically. Changing an animation's duration here means updating the matching offset(s) in `script.js`'s `times` map too — they are not derived from each other.

- **`public/uploads/`** — runtime-written, gitignored. In Docker this is a bind-mounted volume (`/opt/tekrop/shooting-stars/uploads` on the host per `docker-compose.yml`) so uploads survive container recreation. `clean_old_uploads.sh` (meant to run via host cron, not inside the container) deletes uploaded files older than 30 days from a hardcoded path.

## Notes

- `helmet` + `compression` + `morgan` are applied globally in `server.js`; any new route added there inherits them for free.
- The upload filter only checks MIME type (`image/*`), not file contents or extension.
- Port is `9595` by default (`HTTP_PORT` env var), and in the current compose setup is bound to localhost only.
