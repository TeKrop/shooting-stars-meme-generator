# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page site that recreates the "shooting stars" meme: a background video plays, and up to 6 images (uploaded by the user, or the default doge image) fly across the screen in sync with hardcoded animation keyframes. No frontend framework, runtime/build tooling is Bun (native CSS/TS bundling, dev-mode HMR, HTTP server), no database — uploaded files on disk are the only state. Written in TypeScript; Bun runs `.ts` files directly (strips types, no compile-to-disk step).

## Commands

Docker (preferred workflow, via `just`):
```sh
just build       # docker compose build
just start       # docker compose up -d       (production: bun server/server.ts, bundles/minifies/caches lazily at runtime)
just dev         # docker compose --profile dev up bun-dev  (live HMR via `bun --hot`)
just check       # tsc --noEmit + biome check, inside the dev container (see Notes — Bun itself doesn't type-check)
just format      # biome check --write, auto-fixes lint/format issues
just up          # build + start
just shell       # shell into the bun container
just test        # bun test, inside the dev container
just down        # stop + remove containers (keeps volumes)
just down_clean  # stop + remove containers AND volumes
just lock        # regenerate bun.lock inside the container
```

Tests are `bun:test` (`tests/server.test.ts`), invoked via `just test` or
`bun test` directly (Bun's own test runner — no Jest/Vitest needed). Linting/
formatting is Biome (`biome.json`), invoked via `just check`/`just format`.

## Configuration

Copy `.env.dist` to `.env` to override `APP_PORT`/`HASH_LENGTH`/`UPLOADS_DIR`/
`UPLOAD_RETENTION_DAYS`. These are picked up two different ways:
`HASH_LENGTH`/`UPLOAD_RETENTION_DAYS` flow through `docker-compose.yml`'s
`env_file:` into the container's `process.env`, for `server.ts` and
`scripts/clean_old_uploads.sh` to read; `APP_PORT`/`UPLOADS_DIR` are only ever
read by `docker compose` itself, via plain shell-style `${VAR}` interpolation
when parsing `docker-compose.yml` — for the host-side port mapping and the
uploads bind-mount path shared by the `bun`/`bun-dev`/`cleanup` services.
Both mechanisms read the same `.env` file but are otherwise unrelated
features of Compose. The app's own listening port is deliberately NOT
configurable — `server.ts` hardcodes `9595` whether run via `bun server/server.ts`
directly or inside a container; only the Docker host-side publish port
(`APP_PORT`, default `9595`) can differ. `.env` is optional, so a missing one
still works, falling back to `server.ts`'s built-in defaults and to
`docker-compose.yml`'s own `${VAR:-default}` fallbacks (currently
`/tmp/shooting-stars-uploads` for `UPLOADS_DIR` — a dedicated subfolder rather
than bare `/tmp`, so the bind mount doesn't pull in unrelated files already
sitting in the host's shared `/tmp`; point it at a real persistent host path
for production). Docker creates the directory itself on first `up` if it
doesn't exist yet — no manual setup needed — and the `cleanup` service's own
age-based pruning (see Architecture below) applies to it the same as any
other path, so there's no extra lifecycle to manage beyond that.
`NODE_ENV` is deliberately NOT in `.env` — it only appears once in the whole
project, as
`ENV NODE_ENV=production` in the `Dockerfile`'s prod stage. That single line
is load-bearing: it's the one signal Bun.serve checks to switch its
HTML-import bundler from dev mode (unminified, `/_bun/...` paths) to
production mode (minified, cached, hashed filenames) — confirmed by testing,
not an assumption. The `dev` stage sets nothing; Bun already defaults to
dev-mode bundling when the var is unset.

## TypeScript

`tsconfig.json` covers both runtimes in the project with one shared config
(not worth splitting for a project this size): `"types": ["bun"]` for
`server/server.ts`'s Bun globals (`Bun`, `process`, `import.meta.dir`), `"lib":
["ESNext", "DOM", "DOM.Iterable"]` for `client/script.ts`'s browser globals
(`document`, `window`, etc.). Note `"types": ["bun"]` is required, not
optional — omitting it entirely (relying on TS's default "auto-include every
`@types/*` package") does NOT pick up `@types/bun`'s ambient globals, even
though it does still resolve regular module imports like `randomstring` fine
(confirmed by testing: without it, `Bun`/`process`/`import.meta.dir` are all
unresolvable errors). `@types/randomstring` needs no entry in `"types"` since
that only gates ambient/global declarations, not normal `import` resolution.

Bun strips TypeScript syntax at load time but does **not** type-check —
`bun --hot server/server.ts` / `bun server/server.ts` will happily run code with type
errors. `just check` (`tsc --noEmit`, no emit since Bun never reads compiled
output, plus `biome check`) is the only thing that actually catches them;
it isn't wired into `just build`/`just dev` automatically.

## Linting/formatting

Biome (`biome.json`) replaces the usual ESLint+Prettier pair — one tool,
one config, no plugins needed for a project this size. Two deliberate rule
overrides on top of the recommended preset:
- `style/noNonNullAssertion` off — `client/script.ts` leans on `!`/`as` casts
  for DOM lookups of elements that are always present (see Architecture
  below); the rule's blanket ban doesn't fit that pattern.
- `a11y/useMediaCaption` off — the one `<video>` in `index.html` is a silent
  decorative background loop with no dialogue, so a captions requirement
  doesn't apply.

CSS formatting/linting is enabled (default), which reformats `client/style.css`'s
`@keyframes` rules from compact one-liners into one-property-per-line —
purely cosmetic, no behavior change.

`vcs.useIgnoreFile: true` needs an actual `.gitignore` present to work, so
it's bind-mounted into `bun-dev` alongside the other source paths — without
it, `biome check` fails outright inside the container (confirmed by
testing) rather than silently skipping the exclusion.

## Architecture

The repo is split into `server/` (Bun backend) and `client/` (everything Bun's
HTML-import bundler processes), plus `scripts/` (ops tooling) and `tests/` —
project-level config (`Dockerfile`, `docker-compose.yml`, `justfile`,
`package.json`, `tsconfig.json`, `biome.json`, `.env.dist`) stays at the root.

- **`server/server.ts`** — the entire backend, built around `Bun.serve()`:
  - `import index from '../client/index.html'` — Bun's HTML-import bundling parses `index.html`, discovers its linked `client/style.css`/`client/script.ts`/bundled assets, and bundles them. Whether this happens in dev mode (on-demand, unminified, HMR) or production mode (minified, cached, hashed filenames) is decided by Bun itself purely from the `NODE_ENV` env var (`production` → prod bundling, anything else → dev bundling) — `server.ts` has no explicit dev/prod branching of its own for this.
  - `routes` table: `'/'` and the wildcard `'/*'` both serve the `index` HTML bundle (the wildcard is the SPA-style fallback for an uploaded-image hash path like `/abc12` — the hash is read client-side from `location.pathname`, not routed server-side). These two routes can't be wrapped for logging: Bun's HTML-bundle value can only be returned by direct assignment (`'/': index`), not from inside a route handler function — returning it from a function silently produces a bogus placeholder response instead (tested against Bun 1.3.14). Every other route is a plain function and does get logged.
  - `'/upload'` has a `POST` handler that reads the file via `req.formData()` (native multipart parsing, no `multer`) and writes it to `uploads/` via `Bun.write()` under a `randomstring`-generated name (length controlled by `HASH_LENGTH` env var), then redirects to `/<hash>`.
  - `'/uploads/*'` serves files from `uploads/` via `Bun.file()`. `'/img/*'` similarly serves `client/public/img/` — needed because `script.ts` references `img/doge.png` dynamically at runtime (a plain string, not statically analyzable), so the HTML bundler can't pick it up the way it does the video/CSS/JS. Both go through `serveFrom()`, whose `../` path-traversal safety was verified by testing (plain, percent-encoded, and double-encoded traversal attempts all correctly blocked) — it relies on `new URL().pathname` normalizing dot segments before the path is sliced, so don't switch that to raw `req.url` string matching without re-verifying.
  - A few security response headers (`X-Content-Type-Options`, `X-Frame-Options`, a basic CSP) are set on every response we build ourselves — no `helmet` dependency needed for this. Not applied to the HTML-bundle routes (`'/'`/`'/*'`) since Bun's HTML-import routing doesn't expose a documented way to attach custom headers to those.
  - `log()` is a tiny timestamped `console.log` wrapper used for startup info, every upload attempt (success with filename/type/size, or rejection reason), every static file serve/404 under `/uploads/*` and `/img/*`, and uncaught errors (via Bun.serve's `error` hook). The two HTML-bundle routes are the one place that can't be logged per-request, per the limitation above.
  - Bun loads `.env` files natively — no `dotenv`.
  - `uploadsDir` (`${import.meta.dir}/../uploads`) and the `/img/*` static folder (`${import.meta.dir}/../client/public/img`) both resolve relative to `server.ts`'s own location, since `uploads/` and `client/` are siblings of `server/`, not nested inside it.
  - The `Bun.serve()` return value is kept (`const server = ...`) and `export default`ed purely so `tests/server.test.ts` can `fetch()` against it directly, in-process — not used by `server.ts` itself otherwise.

- **`client/index.html`** (Bun's HTML-import entry point) — links `./style.css` and `./script.ts` via plain relative paths (siblings in the same folder), and the background video via `./public/videos/background.mp4` (a real relative path so Bun's bundler picks it up, copies it, and rewrites the URL — referencing it as `/videos/background.mp4` instead makes the bundler try and fail to resolve it as a module). The favicon `<link>` is the one asset-looking tag Bun's bundler does NOT process at all, so it keeps a plain `/img/favicon.png` server-relative href, served by the `/img/*` route.

- **`client/script.ts`** — all client logic, no bundler-specific APIs beyond being loaded as an ES module (`type="module"`). Reads the current URL path: if it's `/` shows `img/doge.png`, otherwise treats the path as an uploaded image hash and points all 6 `<img>` elements at `uploads/<hash>`. The `times` map in `startAnimation()` is the choreography table (typed as `Record<number, AnimationStage>`): keys are millisecond offsets, values say which CSS class each picture should have at that offset (driven by `setTimeout`, not `requestAnimationFrame`). This map's timings must line up with `videos/background.mp4`'s runtime and with the animation durations defined in the CSS. DOM lookups use non-null assertions/casts (`document.getElementById('video') as HTMLVideoElement`, etc.) rather than defensive null checks, since these are static elements always present in `index.html`.

- **`client/style.css`** — the actual animation, expressed as native CSS `@keyframes` per stage (`init`, `spaceone`, `dolphins`, `spacetwo`, `microone`, `microtwo`). Each stage has per-picture keyframe variants (e.g. `spacetwo_1` through `spacetwo_6`) with different transform/timing so images don't move identically. Changing an animation's duration here means updating the matching offset(s) in `script.ts`'s `times` map too — they are not derived from each other. Uses native CSS nesting (`&:hover`, `&.hide`) — Bun's bundler (Lightning CSS) supports this directly, no preprocessor needed. Was originally LESS; converted to plain CSS since Bun's bundler doesn't support LESS and the only genuinely LESS-specific features in the file were a few `@variable`-based compile-time arithmetic values in the `init` keyframes, now inlined as literals.

- **`client/public/img/doge.png`** — the only asset still served through a manual route rather than the HTML bundler, since it's referenced dynamically (see `script.ts` above). `client/public/` also holds `favicon.png`/`preview.jpg` (same manual-route reasoning) and `videos/background.mp4` (bundler-processed, see `index.html` above).

- **`uploads/`** — runtime-written, gitignored, lives at the project root (a sibling of `server/`/`client/`, not nested inside either — it's runtime data, not source). In Docker this is a bind-mounted volume (`${UPLOADS_DIR}` on the host, defaulting to `/tmp/shooting-stars-uploads` per `docker-compose.yml` — point it at a real persistent path for production) so uploads survive container recreation, shared by the `bun`/`bun-dev` and `cleanup` services.

- **`scripts/clean_old_uploads.sh`** + **`scripts/Dockerfile`** — the upload-retention job, now containerized instead of relying on host cron. The script wraps `find "$PATH_TO_UPLOADS" -ctime "+$UPLOAD_RETENTION_DAYS" -delete`; `PATH_TO_UPLOADS` defaults to `/uploads` (the cleanup service's fixed container-side mount point — not meant to be overridden via `.env`, unlike `UPLOADS_DIR` which controls the host side of that same mount), and `UPLOAD_RETENTION_DAYS` (default `30`) is read directly under the same name it has in `.env`, no renaming layer anywhere in the chain. If every upload ages out at once, `find` will also try (and harmlessly fail, "Device or resource busy") to delete the `/uploads` mount point itself — the entrypoint's loop ignores the resulting non-zero exit. The `cleanup` service picks up `.env` the same way `bun`/`bun-dev` do, via `env_file:`, rather than cherry-picking individual vars into an `environment:` block. `scripts/Dockerfile` is a tiny `alpine:3` + `findutils` image (alpine's own `find` is busybox's and doesn't support `-ctime`) whose entrypoint is a `while true; sleep 1d` loop around the script — a deliberate shortcut over a real `crond` entry, since there's exactly one daily job; swap to `crond` if a real schedule (specific time, multiple jobs) is ever needed. Wired into `docker-compose.yml` as the `cleanup` service (default profile, runs alongside `bun` in production; `restart: unless-stopped`).

- **`Dockerfile`** — based on `oven/bun:1-alpine`, working directory `/app`. A `deps` stage runs `bun install --frozen-lockfile` (shared by both targets — there's no dev/prod dependency split, so `typescript`/`@types/*` devDependencies ride along into the prod image unused at runtime, a deliberate simplicity-over-size trade-off); a `dev` target runs `bun --hot server/server.ts` against bind-mounted source for live HMR; the final untargeted stage copies `tsconfig.json`/`server/`/`client/` in and runs `bun server/server.ts` with `NODE_ENV=production` (bundling/minification happens lazily at runtime, no build stage or `dist/` artifact needed).

- **`docker-compose.yml`** — three services: `bun` (default profile, production), `bun-dev` (profile `dev`, builds the `dev` Dockerfile target, bind-mounts `server/`/`client/`/`tsconfig.json`/`biome.json`/`.gitignore`/`tests/` for live editing — `just check`/`just format`/`just test` also run as one-off `docker compose run`s against this same service, so they always check/fix/test the current working tree rather than whatever was last baked into an image), and `cleanup` (default profile, builds `scripts/`, runs the upload-retention job). `bun`/`bun-dev`'s port mapping is `"${APP_PORT:-9595}:9595"` — only the host side is configurable via `.env`; the container side is always `9595`, matching `server.ts`'s hardcoded port. `UPLOADS_DIR`'s bind-mount path is likewise a `${VAR:-default}` interpolation rather than hardcoded.

- **`tests/server.test.ts`** — `bun:test` against the real `server/server.ts`, imported directly (its port is fixed at `9595`, but each `bun test` run happens in its own throwaway container via `docker compose run`, which doesn't publish ports, so it never collides with an already-running `bun`/`bun-dev` service). Covers: `/` loads, an image upload redirects to a `/<hash>` URL that itself loads, a non-image upload is rejected back to `/`, a never-uploaded hash 404s under `/uploads/*`, security headers are present on `/uploads/*` responses, and `/img/*` serves the default doge image. Cleans up any file it writes to `uploads/` in `afterAll`.

## Notes

- The upload filter only checks MIME type (`image/*`), not file contents or extension.
- The app always listens on `9595`; only the Docker host-side publish port (`APP_PORT` env var) can differ, and in the current compose setup is bound to localhost only.
- Uploaded files older than `UPLOAD_RETENTION_DAYS` (default 30) are deleted daily by the `cleanup` compose service — see `scripts/` in Architecture above.

## Contributing

Commit messages **must** follow [Conventional Commits](https://www.conventionalcommits.org/)
(`type(scope): subject`, e.g. `fix: correct upload hash length`) — this isn't
just style. `.releaserc.json` runs `semantic-release` with the default
`@semantic-release/commit-analyzer` (Angular preset) on every push to `main`
via `.github/workflows/release.yaml`: it parses commit types to decide
whether to cut a release and what version bump to apply (`fix:` → patch,
`feat:` → minor, `BREAKING CHANGE:` footer or `!` → major, other types like
`chore:`/`docs:`/`refactor:` → no release), then generates `CHANGELOG.md`
entries from those same messages. A non-conventional commit message is
silently ignored by the analyzer rather than erroring, so the practical
failure mode is a change landing with no version bump/changelog entry, not
a build break. Before opening a PR, run `just check`/`just test` locally
(see Commands above) — CI (`.github/workflows/build.yml`) runs the same
checks.
