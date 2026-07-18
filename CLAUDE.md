# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page site that recreates the "shooting stars" meme: a background video plays, and up to 6 images (uploaded by the user, or the default doge image) fly across the screen in sync with hardcoded animation keyframes. No frontend framework, runtime/build tooling is Bun (native CSS/TS bundling, dev-mode HMR, HTTP server), no database — uploaded files on disk are the only state. Written in TypeScript; Bun runs `.ts` files directly (strips types, no compile-to-disk step).

## Commands

Docker (preferred workflow, via `just`):
```sh
just build       # docker compose build
just start       # docker compose up -d       (production: bun server.ts, bundles/minifies/caches lazily at runtime)
just dev         # docker compose --profile dev up bun-dev  (live HMR via `bun --hot`)
just check       # tsc --noEmit + biome check, inside the dev container (see Notes — Bun itself doesn't type-check)
just format      # biome check --write, auto-fixes lint/format issues
just up          # build + start
just shell       # shell into the bun container
just down        # stop + remove containers (keeps volumes)
just down_clean  # stop + remove containers AND volumes
just lock        # regenerate bun.lock inside the container
```

There is no test suite (`npm test` is a stub). Linting/formatting is Biome (`biome.json`), invoked via `just check`/`just format`.

## Configuration

Copy `.env.dist` to `.env` to override `HTTP_PORT`/`HASH_LENGTH` (picked up by
`docker-compose.yml`'s `env_file:`, optional so a missing `.env` still works
with `server.ts`'s built-in defaults). `NODE_ENV` is deliberately NOT in
`.env` — it only appears once in the whole project, as `ENV NODE_ENV=production`
in the `Dockerfile`'s prod stage. That single line is load-bearing: it's the
one signal Bun.serve checks to switch its HTML-import bundler from dev mode
(unminified, `/_bun/...` paths) to production mode (minified, cached, hashed
filenames) — confirmed by testing, not an assumption. The `dev` stage sets
nothing; Bun already defaults to dev-mode bundling when the var is unset.

## TypeScript

`tsconfig.json` covers both runtimes in the project with one shared config
(not worth splitting for a project this size): `"types": ["bun"]` for
`server.ts`'s Bun globals (`Bun`, `process`, `import.meta.dir`), `"lib":
["ESNext", "DOM", "DOM.Iterable"]` for `src/script.ts`'s browser globals
(`document`, `window`, etc.). Note `"types": ["bun"]` is required, not
optional — omitting it entirely (relying on TS's default "auto-include every
`@types/*` package") does NOT pick up `@types/bun`'s ambient globals, even
though it does still resolve regular module imports like `randomstring` fine
(confirmed by testing: without it, `Bun`/`process`/`import.meta.dir` are all
unresolvable errors). `@types/randomstring` needs no entry in `"types"` since
that only gates ambient/global declarations, not normal `import` resolution.

Bun strips TypeScript syntax at load time but does **not** type-check —
`bun --hot server.ts` / `bun server.ts` will happily run code with type
errors. `just check` (`tsc --noEmit`, no emit since Bun never reads compiled
output, plus `biome check`) is the only thing that actually catches them;
it isn't wired into `just build`/`just dev` automatically.

## Linting/formatting

Biome (`biome.json`) replaces the usual ESLint+Prettier pair — one tool,
one config, no plugins needed for a project this size. Two deliberate rule
overrides on top of the recommended preset:
- `style/noNonNullAssertion` off — `src/script.ts` leans on `!`/`as` casts
  for DOM lookups of elements that are always present (see Architecture
  below); the rule's blanket ban doesn't fit that pattern.
- `a11y/useMediaCaption` off — the one `<video>` in `index.html` is a silent
  decorative background loop with no dialogue, so a captions requirement
  doesn't apply.

CSS formatting/linting is disabled entirely (`css.formatter.enabled: false`,
`css.linter.enabled: false`) — Biome's CSS formatter rewrites the compact
one-line `@keyframes` rules in `src/style.css` into a much more verbose
multi-line style, which was a large, purely-cosmetic diff unrelated to
anything actually being changed; not worth it for one file.

`vcs.useIgnoreFile: true` needs an actual `.gitignore` present to work, so
it's bind-mounted into `bun-dev` alongside the other source paths — without
it, `biome check` fails outright inside the container (confirmed by
testing) rather than silently skipping the exclusion.

## Architecture

- **`server.ts`** — the entire backend, built around `Bun.serve()`:
  - `import index from './index.html'` — Bun's HTML-import bundling parses `index.html`, discovers its linked `src/style.css`/`src/script.ts`/bundled assets, and bundles them. Whether this happens in dev mode (on-demand, unminified, HMR) or production mode (minified, cached, hashed filenames) is decided by Bun itself purely from the `NODE_ENV` env var (`production` → prod bundling, anything else → dev bundling) — `server.ts` has no explicit dev/prod branching of its own for this.
  - `routes` table: `'/'` and the wildcard `'/*'` both serve the `index` HTML bundle (the wildcard is the SPA-style fallback for an uploaded-image hash path like `/abc12` — the hash is read client-side from `location.pathname`, not routed server-side). These two routes can't be wrapped for logging: Bun's HTML-bundle value can only be returned by direct assignment (`'/': index`), not from inside a route handler function — returning it from a function silently produces a bogus placeholder response instead (tested against Bun 1.3.14). Every other route is a plain function and does get logged.
  - `'/upload'` has a `POST` handler that reads the file via `req.formData()` (native multipart parsing, no `multer`) and writes it to `uploads/` via `Bun.write()` under a `randomstring`-generated name (length controlled by `HASH_LENGTH` env var), then redirects to `/<hash>`.
  - `'/uploads/*'` serves files from `uploads/` via `Bun.file()`. `'/img/*'` similarly serves `public/img/` — needed because `script.ts` references `img/doge.png` dynamically at runtime (a plain string, not statically analyzable), so the HTML bundler can't pick it up the way it does the video/CSS/JS.
  - A few security response headers (`X-Content-Type-Options`, `X-Frame-Options`, a basic CSP) are set on every response we build ourselves — no `helmet` dependency needed for this. Not applied to the HTML-bundle routes (`'/'`/`'/*'`) since Bun's HTML-import routing doesn't expose a documented way to attach custom headers to those.
  - `log()` is a tiny timestamped `console.log` wrapper used for startup info, every upload attempt (success with filename/type/size, or rejection reason), every static file serve/404 under `/uploads/*` and `/img/*`, and uncaught errors (via Bun.serve's `error` hook). The two HTML-bundle routes are the one place that can't be logged per-request, per the limitation above.
  - Bun loads `.env` files natively — no `dotenv`.

- **`index.html`** (project root, Bun's HTML-import entry point) — links `src/style.css` and `src/script.ts` via plain relative paths, and the background video via `./public/videos/background.mp4` (a real relative path so Bun's bundler picks it up, copies it, and rewrites the URL — referencing it as `/videos/background.mp4` instead makes the bundler try and fail to resolve it as a module). The favicon `<link>` is the one asset-looking tag Bun's bundler does NOT process at all, so it keeps a plain `/img/favicon.png` server-relative href, served by the `/img/*` route.

- **`src/script.ts`** — all client logic, no bundler-specific APIs beyond being loaded as an ES module (`type="module"`). Reads the current URL path: if it's `/` shows `img/doge.png`, otherwise treats the path as an uploaded image hash and points all 6 `<img>` elements at `uploads/<hash>`. The `times` map in `startAnimation()` is the choreography table (typed as `Record<number, AnimationStage>`): keys are millisecond offsets, values say which CSS class each picture should have at that offset (driven by `setTimeout`, not `requestAnimationFrame`). This map's timings must line up with `videos/background.mp4`'s runtime and with the animation durations defined in the CSS. DOM lookups use non-null assertions/casts (`document.getElementById('video') as HTMLVideoElement`, etc.) rather than defensive null checks, since these are static elements always present in `index.html`.

- **`src/style.css`** — the actual animation, expressed as native CSS `@keyframes` per stage (`init`, `spaceone`, `dolphins`, `spacetwo`, `microone`, `microtwo`). Each stage has per-picture keyframe variants (e.g. `spacetwo_1` through `spacetwo_6`) with different transform/timing so images don't move identically. Changing an animation's duration here means updating the matching offset(s) in `script.ts`'s `times` map too — they are not derived from each other. Uses native CSS nesting (`&:hover`, `&.hide`) — Bun's bundler (Lightning CSS) supports this directly, no preprocessor needed. Was originally LESS; converted to plain CSS since Bun's bundler doesn't support LESS and the only genuinely LESS-specific features in the file were a few `@variable`-based compile-time arithmetic values in the `init` keyframes, now inlined as literals.

- **`public/img/doge.png`** — the only asset still served through a manual route rather than the HTML bundler, since it's referenced dynamically (see `script.ts` above).

- **`uploads/`** — runtime-written, gitignored, lives at the project root. In Docker this is a bind-mounted volume (`/opt/tekrop/shooting-stars/uploads` on the host per `docker-compose.yml`) so uploads survive container recreation. `clean_old_uploads.sh` (meant to run via host cron, not inside the container) deletes uploaded files older than 30 days from a hardcoded path.

- **`Dockerfile`** — based on `oven/bun:1-alpine`, working directory `/app`. A `deps` stage runs `bun install --frozen-lockfile` (shared by both targets — there's no dev/prod dependency split, so `typescript`/`@types/*` devDependencies ride along into the prod image unused at runtime, a deliberate simplicity-over-size trade-off); a `dev` target runs `bun --hot server.ts` against bind-mounted source for live HMR; the final untargeted stage copies the source (including `tsconfig.json`) in and runs `bun server.ts` with `NODE_ENV=production` (bundling/minification happens lazily at runtime, no build stage or `dist/` artifact needed).

- **`docker-compose.yml`** — two services: `bun` (default profile, production) and `bun-dev` (profile `dev`, builds the `dev` Dockerfile target, bind-mounts `server.ts`/`index.html`/`tsconfig.json`/`biome.json`/`.gitignore`/`src/`/`public/` for live editing — `just check`/`just format` also run as one-off `docker compose run`s against this same service, so they always check/fix the current working tree rather than whatever was last baked into an image).

## Notes

- The upload filter only checks MIME type (`image/*`), not file contents or extension.
- Port is `9595` by default (`HTTP_PORT` env var), and in the current compose setup is bound to localhost only.
