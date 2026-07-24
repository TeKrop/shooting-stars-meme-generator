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
just check       # tsc --noEmit + biome check + stars.css freshness check, inside the dev container (see Notes — Bun itself doesn't type-check)
just format      # biome check --write, auto-fixes lint/format issues
just generate-css # regenerate client/css/stars.css from server/keyframes.ts (see Architecture)
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
["ESNext", "DOM", "DOM.Iterable"]` for the `client/*.ts` files' browser globals
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
one config, no plugins needed for a project this size. The linter runs the
full `recommended` preset with no rule overrides, and the formatter uses
Biome's defaults throughout (including double-quote strings — there's no
project-specific `javascript.formatter` override).

`style/noDescendingSpecificity` was overridden at one point (before
`client/style.css` was split into `client/css/*.css` — see Architecture
below). The rule flags a lower-specificity selector defined after a
higher-specificity one for a related selector; each flagged case so far has
been two selectors that never actually collide in the cascade (an ID-scoped
override rule vs. an unrelated plain class), so the fix is a pure reorder —
move the lower-specificity rule earlier in the file — never a behavior
change, since the higher-specificity selector already wins regardless of
source order. `@layer` ordering (see Architecture below) does **not** make
this rule droppable on its own — Biome's specificity check is static and
doesn't model `@layer` semantics at all (confirmed by testing: removing the
override with `@layer`s in place still raised the same warnings, until the
underlying selectors were reordered).

CSS formatting/linting is enabled (default), which reformats `@keyframes`
rules from compact one-liners into one-property-per-line — purely cosmetic,
no behavior change.

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
  - `'/upload'` has a `POST` handler that reads the file via `req.formData()` (native multipart parsing, no `multer`) and writes it to `uploads/` under a randomly generated `<hash>.png` name (hash length controlled by `HASH_LENGTH` env var), then redirects to `/<hash>`. Only accepts `image/png` under `MAX_UPLOAD_SIZE` (15MB, generous — `$toCanvas()` renders at source-image resolution, not the crop zone's display size, so a large original photo can still produce a large PNG) — the client's preview dialog (see `client/preview.ts` below) always crops and re-encodes through `<canvas>` before uploading, regardless of the source file's original format, so PNG is the only type that's ever legitimately sent. `resolveUpload()` only ever looks for `<hash>.png`; the pre-PNG-restriction fallback that resolved other extensions (and bare, extensionless legacy filenames) was removed once every upload from before that restriction had aged out under `UPLOAD_RETENTION_DAYS`. Rejections redirect to `/?error=<reason>` (`invalid_type` or `too_large`) instead of a bare `/`, so the client can show a specific message (see `client/preview.ts` below) rather than failing silently.
  - `'/uploads/*'` serves files from `uploads/` via `Bun.file()`. `'/img/*'` similarly serves `client/public/img/` — needed because `script.ts` references `img/doge.png` dynamically at runtime (a plain string, not statically analyzable), so the HTML bundler can't pick it up the way it does the video/CSS/JS. `'/videos/*'` serves `client/public/videos/` for the same reason but a different cause: the HTML bundler processes `<video><source src>` but does NOT process a sibling `<track src>` on that same element (confirmed by testing — the `<source>`'s path gets rewritten to a hashed `/_bun/asset/...` URL, the `<track>`'s doesn't), so the video's captions `.vtt` file needs its own manual route rather than riding along with `background.mp4`. All three go through `serveFrom()`, whose `../` path-traversal safety was verified by testing (plain, percent-encoded, and double-encoded traversal attempts all correctly blocked) — it relies on `new URL().pathname` normalizing dot segments before the path is sliced, so don't switch that to raw `req.url` string matching without re-verifying.
  - A few security response headers (`X-Content-Type-Options`, `X-Frame-Options`, a basic CSP) are set on every response we build ourselves — no `helmet` dependency needed for this. Not applied to the HTML-bundle routes (`'/'`/`'/*'`) since Bun's HTML-import routing doesn't expose a documented way to attach custom headers to those.
  - `log()` is a tiny timestamped `console.log` wrapper used for startup info, every upload attempt (success with filename/type/size, or rejection reason), every static file serve/404 under `/uploads/*`, `/img/*`, and `/videos/*`, and uncaught errors (via Bun.serve's `error` hook). The two HTML-bundle routes are the one place that can't be logged per-request, per the limitation above.
  - Bun loads `.env` files natively — no `dotenv`.
  - `uploadsDir`, the `/img/*` static folder (`${import.meta.dir}/../client/public/img`), and the `/videos/*` static folder (`${import.meta.dir}/../client/public/videos`) all resolve relative to `server.ts`'s own location, since `uploads/` and `client/` are siblings of `server/`, not nested inside it.
  - The `Bun.serve()` return value is kept (`const server = ...`) and `export default`ed purely so `tests/server.test.ts` can `fetch()` against it directly, in-process — not used by `server.ts` itself otherwise.
  - `'/export/*'` renders the shooting-stars animation server-side as MP4 (H.264 + AAC, audio copied straight from `background.mp4`) or WebM (VP8 + Vorbis, both re-encoded since WebM can't carry AAC) depending on a `?format=mp4|webm` query param (`server/export.ts`, `@napi-rs/canvas` + a single `ffmpeg` process, no headless browser) — see `server/keyframes.ts` below for the animation data it's built from. WebM is noticeably slower to encode than MP4 (VP8 vs. `libx264 -preset ultrafast`, even at `-deadline realtime -cpu-used 8`) but still finishes in single-digit seconds, not GIF's old ~10-62s. The actual rendering runs in a separate OS thread (`renderExportInWorker()`, `server/export-worker.ts`), not on `Bun.serve`'s own thread — `@napi-rs/canvas`'s per-frame drawing is synchronous native CPU work (unlike the `ffmpeg` subprocess, already off-thread via `Bun.spawn`), so without a worker thread a render would block every other request (page loads, uploads, other exports' progress polls) for the whole render duration. Confirmed by testing: `GET /` still answers in ~1ms while an export renders. The worker communicates back over `parentPort.postMessage()` (progress ticks, then a final `done`/`error`) rather than a return value; it's left to exit on its own once it posts its result — forcibly `worker.terminate()`-ing it from the main thread raced that natural exit and printed a spurious Bun "ObjectRef is not unref" warning on every export.
  - `'/export-status'` reports `{ inProgress, percent }` (module-level state updated once per rendered frame in `renderExport`'s `onProgress` callback) so `client/export.ts` can poll real progress during a render and drive a `<progress>` bar in a dedicated modal `<dialog>` (`#export-progress-dialog`, opened with `showModal()`) rather than a bare spinner — the modal also makes the rest of the page inert for free while a render is in flight, and its `cancel` event is `preventDefault()`-ed so Escape can't dismiss it mid-render (there's no cancel-in-flight support). Deliberately a top-level path, not nested under `/export/`, so it can never collide with that route's wildcard hash matching.

- **`server/keyframes.ts`** — the canonical animation dataset for the export renderer, and (via `scripts/generate-stars-css.ts` below) for `client/css/stars.css` too. Each entry in `ANIMATIONS` is a `PictureAnimation`: per-property control-point arrays (`x`/`y`/`scaleX`/`scaleY`/`rotateDeg`/`opacity`/`filter`) plus a `transformOrder` (`"scale-rotate"` or `"rotate-scale"`) recording which order that specific animation composes its CSS transform functions in — `stars.css` isn't consistent about this (`spaceone`/`dolphins-two` write `translate() scale() rotate()`, the rest write `translate() rotate() scale()`), and since CSS composes transform functions in written order, `server/export.ts`'s canvas rendering has to replicate whichever order each animation actually uses, not one fixed order. A control point can carry `implicit: true` to mark a synthetic identity value added purely so `resolvePictureFrame()`'s linear interpolation has a boundary to interpolate from (e.g. `spacetwo_3`'s transform/filter don't start until 50% in the source CSS; the leading 0% point exists only for the math) — `interpolate()`/`interpolateFilter()` ignore the flag, but `scripts/generate-stars-css.ts` reads it to know not to emit that property at that percentage. This file is meant to be edited directly (unlike `stars.css`); after editing, run `just generate-css` to regenerate `client/css/stars.css`, since `just check` will otherwise fail (see Linting/formatting above).

- **`server/export-worker.ts`** — the worker-thread entry point spawned by `renderExportInWorker()` in `server/export.ts` (see above), so it's a thin wrapper, not a separate implementation: reads its job (`imagePath`/`orientation`/`format`/`dir`) from `worker_threads`' `workerData`, calls the same `renderExport()` the direct (non-worker) path would, and reports back over `parentPort.postMessage()` since a worker's result is message-based, not a return value.

- **`client/index.html`** (Bun's HTML-import entry point) — links `./style.css` and `./script.ts` via plain relative paths (siblings in the same folder), and the background video via `./public/videos/background.mp4` (a real relative path so Bun's bundler picks it up, copies it, and rewrites the URL — referencing it as `/videos/background.mp4` instead makes the bundler try and fail to resolve it as a module). The favicon `<link>` is one asset-looking tag Bun's bundler does NOT process at all, so it keeps a plain `/img/favicon.png` server-relative href, served by the `/img/*` route. The video's `<track kind="captions" src="/videos/background.vtt">` (needed to satisfy `a11y/useMediaCaption`, see Linting/formatting above) is the same story: it's a plain server-relative href rather than a bundler-relative `./` path, served by the `/videos/*` route (see `server.ts` above) — the captions file itself is just a header-only `WEBVTT` with no cues, since the video has no dialogue to transcribe (it does play quiet audio, `animation.ts` sets `video.volume = 0.05`, so `muted` — the rule's other exemption — isn't an option here).

- **`client/script.ts`** — page bootstrap, no bundler-specific APIs beyond being loaded as an ES module (`type="module"`) and importing its sibling modules. Reads the current URL path: if it's `/` shows `img/doge.png`, otherwise treats the path as an uploaded image hash and points all 6 `<img>` elements at `uploads/<hash>`, then creates the 6 `<img id="pict1">` through `<img id="pict6">` elements themselves. Also owns the file-upload-focus class trick (`#file-upload` can't rely on CSS's adjacent-sibling focus trick since it has two labels in different parts of the DOM — see `body.file-upload-focused` in `client/css/buttons.css`), and wires `initPreviewDialog(applyUploadedImage)` (see `client/preview.ts` below). `applyUploadedImage()` is the callback passed into `initPreviewDialog()`: on a successful upload it swaps the 6 pictures' `src`, `history.pushState()`s the new `/<hash>` URL, and calls `startAnimation()` (imported from `client/animation.ts` below) directly — no full page reload. The actual choreography engine lives in `animation.ts`, not here — this file's only ties to it are the `restartAnimation()`/`startAnimation()` imports/calls.

- **`client/animation.ts`** — the shooting-stars choreography engine, split out of `script.ts` since it's a self-contained concern (launch-prompt gating + the timed picture/video sequence) with its own DOM refs (`video`, `landing`, `starfield`, `tap-to-play`) and module state (`animationTimeouts`, `launchListenersAttached`), unrelated to `script.ts`'s one-time bootstrap work. `startAnimation()`'s loop drives off `ANIMATION_TIMELINE`, imported from `client/animation-timeline.ts` (see below) rather than defined inline, so both this module and the server-side export renderer read the exact same stage timeline. DOM lookups use `as Type` casts (`document.getElementById('video') as HTMLVideoElement`, etc.) rather than defensive null checks, since these are static elements always present in `index.html` — a cast, not a bare `!` non-null assertion, since `noNonNullAssertion` is enforced (see Linting/formatting above) and only the latter trips it. `startAnimation()` is only ever wired to `#tap-to-play` itself (a real `<button>`, not `window`) — clicking/tapping/keyboard-activating that one element is the only way to launch, no target-filtering guard needed since nothing else can reach the listener. Exports `restartAnimation`/`startAnimation` for `script.ts` to call; wires `video`'s own `'ended'` listener (→ `restartAnimation`) itself at module load, since that's part of this module's own lifecycle rather than the bootstrap's.

- **`client/animation-timeline.ts`** — pure data, no DOM access: `AnimationStage` type and `ANIMATION_TIMELINE` (millisecond offsets → which stage class applies and which `pictN` ids are visible), split out of `animation.ts` specifically so `server/export.ts` can import the timeline without pulling in `animation.ts`'s top-level `document.getElementById(...)` calls, which throw outside a browser (e.g. under `bun test`). This map's timings must still line up with `videos/background.mp4`'s runtime and with the animation durations defined in `client/css/stars.css` by hand — nothing derives one from the other.

- **`client/preview.ts`** — the pre-upload preview dialog: file picked → crop step → optional transparency-editing step → upload. Uses [`cropperjs`](https://github.com/fengyuanchen/cropperjs) (v2, the Web Components rewrite — `new Cropper(image, { container })` renders a `<cropper-canvas>` tree of custom elements, not a single widget) for the crop step, driven through its `$`-prefixed instance API (`$ready`, `$center`, `$scale`, `getCropperSelection()`, `$change`, `$toCanvas`) rather than DOM attributes. On crop-step init, the image is sized to `IMAGE_FIT_SCALE` (80%) of the crop zone via `$center('contain').$scale(...)`, and the selection is immediately `$change()`'d to match the image's own rendered bounds exactly (read back via `getBoundingClientRect()` on the image vs. the canvas) — cropperjs's own `initial-coverage` option sizes the selection against the *canvas*, not the image, so without this a full-coverage selection would include the empty letterboxed margin as extra transparent space whenever the image and crop zone aspect ratios don't match. `(getCropperSelection() as CropperSelection).$toCanvas()` renders the crop result into `#edit-canvas`, handing off to `initTransparencyTools()` (see below) for the second step. Final upload always goes out as `cropped.png` via `fetch('/upload', ...)` regardless of whether the user touched the transparency tools, since the server only accepts PNG (see `server.ts` above). `fetch` follows the 303 itself, so the outcome is read from the final `res.url`/`res.status` rather than the redirect header directly: a hash-shaped path means success (dialog closes, `onUploaded(hash)` callback fires — no navigation); a bare `/` with an `error` query param, a `>=500` status, or a thrown/rejected `fetch` (network failure) all close the dialog and show a reason-specific message via `#upload-error` (a dismissible, auto-timeout toast — see `UPLOAD_ERROR_MESSAGES`) instead of reloading the page or failing silently.

- **`client/transparency.ts`** — the optional second dialog step: erase (drag a brush, `globalCompositeOperation: 'destination-out'`) or color-pick (click a pixel, clear every pixel within a Euclidean-RGB-distance tolerance via `ImageData`) to make parts of the cropped canvas transparent. Both tools share one undo/redo stack of `ImageData` snapshots (capped at `MAX_HISTORY`, taken once per pointerdown so a whole drag is one undo step, not one per brush dab). `initTransparencyTools()` returns a `reset()` used by `preview.ts` to clear tool/history state each time a fresh crop lands in `#edit-canvas`.

- **`client/style.css`** — a thin manifest, not a stylesheet in its own right: declares the cascade layer order (`@layer base, components, dialog, stars, responsive;`) and `@import`s each domain file below from `client/css/`. `index.html` still links this one file directly (`./style.css`); Bun's bundler (Lightning CSS) resolves and inlines the `@import`s into a single bundled stylesheet at build/serve time — confirmed by testing (dev-mode bundle output), not an assumption. Layer order is what actually matters here: a later layer's rules win over an earlier layer's regardless of selector specificity or source order, which is what lets `css/responsive.css` (last) reliably override `css/buttons.css`/`css/landing.css` (`components`) without fighting ID-vs-class specificity.
  - **`client/css/base.css`** (`layer: base`) — global page chrome that's always present regardless of screen: `:root` theme variables, `html`/`body` reset, `#starfield`, the background `video#video` element and `#pictures-container`, and the persistent `footer`.
  - **`client/css/buttons.css`** (`layer: components`) — shared button chrome used both on the landing screen and persistently during playback: `.console-btn` (+ `--primary`/`--secondary` variants), `#quick-actions`/`.dock-btn`, and the hidden `#file-upload` input + its focus-ring trick.
  - **`client/css/landing.css`** (`layer: components`) — the idle-state UI: `#landing`, `.console-card` and its contents, `#upload-error`.
  - **`client/css/dialog.css`** (`layer: dialog`) — the upload preview dialog: crop/edit steps, `.tool-picker`, `.slider-control`, `.preview-actions`.
  - **`client/css/stars.css`** (`layer: stars`) — the actual shooting-stars animation, expressed as native CSS `@keyframes` per stage (`init`, `spaceone`, `dolphins`, `spacetwo`, `microone`, `microtwo`). Each stage has per-picture keyframe variants (e.g. `spacetwo_1` through `spacetwo_6`) with different transform/timing so images don't move identically. **This file is generated, not hand-edited** — `scripts/generate-stars-css.ts` writes it from `server/keyframes.ts`'s `ANIMATIONS` data (see Architecture below); edit the data there and run `just generate-css`, don't edit this file directly, since `just check` regenerates it in `--check` mode and fails the build if the two have drifted. Changing an animation's duration still means updating the matching offset(s) in `client/animation-timeline.ts`'s `ANIMATION_TIMELINE` too — durations and stage timing are not derived from each other.
  - **`client/css/responsive.css`** (`layer: responsive`, last) — the `prefers-reduced-motion`/`max-width`/`orientation` media queries, kept as one file rather than split into each component's own file since they already cross-cut `console-btn`/`dock-btn`/`footer`/`console-card` and reordering them into per-component files would obscure the "these are the overrides" mental model.

  All files use native CSS nesting (`&:hover`, `&.hide`) — Bun's bundler (Lightning CSS) supports this directly, no preprocessor needed. Was originally one LESS file; converted to plain CSS since Bun's bundler doesn't support LESS and the only genuinely LESS-specific features were a few `@variable`-based compile-time arithmetic values in the `init` keyframes, now inlined as literals.

- **`client/public/img/doge.png`** — served through a manual route rather than the HTML bundler, since it's referenced dynamically (see `script.ts` above). `client/public/` also holds `favicon.png`/`preview.jpg` (same manual-route reasoning), `videos/background.vtt` (manual route too, for the `<track>`-isn't-bundled reason described under `index.html` above), and `videos/background.mp4` (bundler-processed, see `index.html` above).

- **`uploads/`** — runtime-written, gitignored, lives at the project root (a sibling of `server/`/`client/`, not nested inside either — it's runtime data, not source). In Docker this is a bind-mounted volume (`${UPLOADS_DIR}` on the host, defaulting to `/tmp/shooting-stars-uploads` per `docker-compose.yml` — point it at a real persistent path for production) so uploads survive container recreation, shared by the `bun`/`bun-dev` and `cleanup` services.

- **`scripts/generate-stars-css.ts`** — generates `client/css/stars.css` from `server/keyframes.ts`'s `ANIMATIONS` (see above); run via `bun run generate:css`/`just generate-css` to write the file, or `bun run generate:css` with `--check` (wired as the `verify:css` script, folded into `bun run check`/`just check`) to compare the generated text against what's on disk and exit non-zero without writing — this is what actually enforces that the two files can't silently drift apart. Byte-identical output isn't the goal (Biome reformats the file anyway via `just format`); behavioral equivalence is — e.g. it always emits the two-argument `scale(x, y)` form even where `stars.css` was originally hand-authored with `scale(n)` or `scaleX(n)`, since they're computationally identical. Needs `./scripts` bind-mounted into the `bun-dev` service in `docker-compose.yml` (added alongside `server`/`client`) since `just check`/`just generate-css` both run inside that container.

- **`scripts/clean_old_uploads.sh`** + **`scripts/Dockerfile`** — the upload-retention job, now containerized instead of relying on host cron. The script wraps `find "$PATH_TO_UPLOADS" -ctime "+$UPLOAD_RETENTION_DAYS" -delete`; `PATH_TO_UPLOADS` defaults to `/uploads` (the cleanup service's fixed container-side mount point — not meant to be overridden via `.env`, unlike `UPLOADS_DIR` which controls the host side of that same mount), and `UPLOAD_RETENTION_DAYS` (default `30`) is read directly under the same name it has in `.env`, no renaming layer anywhere in the chain. If every upload ages out at once, `find` will also try (and harmlessly fail, "Device or resource busy") to delete the `/uploads` mount point itself — the entrypoint's loop ignores the resulting non-zero exit. The `cleanup` service picks up `.env` the same way `bun`/`bun-dev` do, via `env_file:`, rather than cherry-picking individual vars into an `environment:` block. `scripts/Dockerfile` is a tiny `alpine:3` + `findutils` image (alpine's own `find` is busybox's and doesn't support `-ctime`) whose entrypoint is a `while true; sleep 1d` loop around the script — a deliberate shortcut over a real `crond` entry, since there's exactly one daily job; swap to `crond` if a real schedule (specific time, multiple jobs) is ever needed. Wired into `docker-compose.yml` as the `cleanup` service (default profile, runs alongside `bun` in production; `restart: unless-stopped`).

- **`Dockerfile`** — based on `oven/bun:1-alpine`, working directory `/app`. A `deps` stage runs `bun install --frozen-lockfile` (shared by both targets — there's no dev/prod dependency split, so `typescript`/`@types/*` devDependencies ride along into the prod image unused at runtime, a deliberate simplicity-over-size trade-off); a `dev` target runs `bun --hot server/server.ts` against bind-mounted source for live HMR; the final untargeted stage copies `tsconfig.json`/`server/`/`client/` in and runs `bun server/server.ts` with `NODE_ENV=production` (bundling/minification happens lazily at runtime, no build stage or `dist/` artifact needed).

- **`docker-compose.yml`** — three services: `bun` (default profile, production), `bun-dev` (profile `dev`, builds the `dev` Dockerfile target, bind-mounts `server/`/`client/`/`tsconfig.json`/`biome.json`/`package.json`/`.gitignore`/`tests/` for live editing — `just check`/`just format`/`just test` also run as one-off `docker compose run`s against this same service, so they always check/fix/test the current working tree rather than whatever was last baked into an image), and `cleanup` (default profile, builds `scripts/`, runs the upload-retention job). `bun`/`bun-dev`'s port mapping is `"${APP_PORT:-9595}:9595"` — only the host side is configurable via `.env`; the container side is always `9595`, matching `server.ts`'s hardcoded port. `UPLOADS_DIR`'s bind-mount path is likewise a `${VAR:-default}` interpolation rather than hardcoded.

- **`tests/server.test.ts`** — `bun:test` against the real `server/server.ts`, imported directly (its port is fixed at `9595`, but each `bun test` run happens in its own throwaway container via `docker compose run`, which doesn't publish ports, so it never collides with an already-running `bun`/`bun-dev` service). Covers: `/` loads, a PNG upload redirects to a `/<hash>` URL that itself loads, a non-image and a non-PNG-image upload are both rejected back to `/`, a never-uploaded hash 404s under `/uploads/*`, security headers are present on `/uploads/*` responses, `/img/*` serves the default doge image, and `/videos/*` serves the background video's captions file. Cleans up any file it writes to `uploads/` in `afterAll`.

## Notes

- The upload filter only checks MIME type (must be exactly `image/png`) and size (`MAX_UPLOAD_SIZE`), not file contents or extension.
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
