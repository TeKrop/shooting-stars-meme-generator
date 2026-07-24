# CLAUDE.md

This file gives guidance to Claude Code (claude.ai/code). Read it before you
work with code in this repository.

## What this is

This project is a single-page site. It recreates the "shooting stars" meme.
A background video plays. Up to 6 images fly across the screen. The images
move in time with fixed animation keyframes. The user uploads the images.
The site shows the default doge image when the user uploads nothing.

The project uses no frontend framework. Bun is the runtime. Bun also bundles
the CSS and the TypeScript. Bun serves HTTP. Bun gives hot module replacement
in development mode. The project uses no database. The uploaded files on disk
hold all of the state.

The code is TypeScript. Bun runs `.ts` files directly. Bun removes the types
at load time. Bun writes no compiled files to disk.

The site can also export the animation as a video file. The server renders it
with a native canvas and `ffmpeg`. It uses no headless browser. The output is
MP4, WebM, or GIF. See `server/export.ts` in Architecture below.

## Commands

Docker is the preferred workflow. Use `just`:
```sh
just build       # docker compose build
just start       # docker compose up -d. Production. Bun bundles, minifies, and caches at runtime.
just dev         # docker compose --profile dev up bun-dev. Live HMR through `bun --hot`.
just check       # tsc --noEmit, biome check, and the stars.css freshness check. Runs in the dev container.
just format      # biome check --write. Corrects lint and format problems.
just generate-css # Regenerates client/css/stars.css from server/keyframes.ts. See Architecture.
just up          # build, then start
just shell       # Opens a shell in the bun container.
just test        # bun test, in the dev container
just test-coverage # bun test --coverage, in the dev container
just down        # Stops and removes the containers. Keeps the volumes.
just down_clean  # Stops and removes the containers and the volumes.
just lock        # Regenerates bun.lock in the container.
just clean       # Prunes the Docker environment.
```

`package.json` holds the same work as plain scripts: `typecheck`, `lint`,
`lint:fix`, `generate:css`, `verify:css`, and `check`. `just check` runs
`bun run check`, which chains the first, the second, and the fifth.

The tests use `bun:test`. They live in `tests/`. There are three files:
`server.test.ts`, `keyframes.test.ts`, and `animation-timeline.test.ts`. Run
them with `just test`. You can also run `bun test` directly. Bun supplies its
own test runner. The project needs no Jest. The project needs no Vitest.
Biome does the linting and the formatting (`biome.json`). Run it with
`just check` or `just format`.

## Configuration

Copy `.env.dist` to `.env` to change `APP_PORT`, `HASH_LENGTH`,
`UPLOADS_DIR`, or `UPLOAD_RETENTION_DAYS`.

Compose reads these variables in two different ways:

- `HASH_LENGTH` and `UPLOAD_RETENTION_DAYS` go through the `env_file:` key in
  `docker-compose.yml`. Compose puts them in the `process.env` of the
  container. `server.ts` reads them. `scripts/clean_old_uploads.sh` reads
  them too.
- `APP_PORT` and `UPLOADS_DIR` never reach the container. Compose itself
  reads them when it parses `docker-compose.yml`. Compose expands them as
  plain shell `${VAR}` text. `APP_PORT` sets the port map on the host.
  `UPLOADS_DIR` sets the path of the uploads bind mount. The `bun`,
  `bun-dev`, and `cleanup` services share that mount.

Both mechanisms read the same `.env` file. They are separate Compose features
in every other way.

The listening port of the application is fixed on purpose. `server.ts`
hardcodes `9595`. This is true for `bun server/server.ts`. It is also true
inside a container. Only the publish port on the host can differ. `APP_PORT`
sets that port. Its default value is `9595`.

`.env` is optional. The project still works without it. `server.ts` then uses
its own default values. Compose then uses its own `${VAR:-default}` values.
The current default for `UPLOADS_DIR` is `/tmp/shooting-stars-uploads`. This
is a dedicated subfolder, not bare `/tmp`. A bare `/tmp` would pull unrelated
host files into the bind mount. Point `UPLOADS_DIR` at a real persistent host
path for production. Docker creates the directory on the first `up`. You need
no manual setup. The `cleanup` service prunes that directory by age, like any
other path. No other lifecycle work is necessary.

`NODE_ENV` is not in `.env` on purpose. It appears one time in the whole
project. The production stage of the `Dockerfile` sets
`ENV NODE_ENV=production`. That single line is load-bearing. `Bun.serve`
reads this variable to select the mode of its HTML-import bundler.
Development mode gives unminified output and `/_bun/...` paths. Production
mode gives minified output, a cache, and hashed filenames. Tests confirmed
this behavior. It is not an assumption. The `dev` stage sets no value. Bun
already defaults to development mode bundling when the variable is empty.

## TypeScript

One shared `tsconfig.json` covers both runtimes in the project. A project of
this size does not need two configurations.

- `"types": ["bun"]` supplies the Bun globals for `server/server.ts`. These
  globals are `Bun`, `process`, and `import.meta.dir`.
- `"lib": ["ESNext", "DOM", "DOM.Iterable"]` supplies the browser globals for
  the `client/*.ts` files. Examples are `document` and `window`.

`"types": ["bun"]` is necessary. It is not optional. TypeScript by default
includes every `@types/*` package. That default does not supply the ambient
globals of `@types/bun`. The default does still resolve normal module
imports. Tests confirmed this. Without the entry, TypeScript cannot resolve
`Bun`, `process`, or `import.meta.dir`. The `"types"` list controls ambient
declarations only. It does not control `import` resolution. A package that
ships its own types therefore needs no entry there.

`"resolveJsonModule": true` is also load-bearing. `client/script.ts` imports
`version` from `package.json` to print the application version in the footer.

Bun removes TypeScript syntax at load time. Bun does **not** check types.
`bun server/server.ts` runs code that has type errors. `bun --hot
server/server.ts` does the same. Only `just check` finds these errors. It
runs `tsc --noEmit` and `biome check`. It emits no files, because Bun never
reads compiled output. `just build` does not run it. `just dev` does not run
it either.

## Linting/formatting

Biome (`biome.json`) replaces the usual pair of ESLint and Prettier. It is
one tool with one configuration. A project of this size needs no plugins.

The linter runs the full `recommended` preset. It overrides no rules. The
formatter uses the Biome default values everywhere. These defaults include
double-quote strings. The project adds no `javascript.formatter` override.

The project overrode `style/noDescendingSpecificity` at one time. This was
before the split of `client/style.css` into `client/css/*.css`. See
Architecture below. The rule flags a selector of low specificity after a
related selector of high specificity. Every flagged case so far held two
selectors that never collide in the cascade. One was an override rule with an
ID. The other was an unrelated plain class. The correction is therefore a
pure reorder. Move the rule of low specificity earlier in the file. The
behavior never changes. The selector of high specificity already wins at any
source position.

The `@layer` order does **not** make this rule safe to drop. The specificity
check of Biome is static. It does not model `@layer` semantics. Tests
confirmed this. The same warnings appeared with the layers in place. The
warnings stopped only after a reorder of the underlying selectors.

CSS formatting and linting are on. This is the default. Biome rewrites
compact one-line `@keyframes` rules into one property per line. This change
is cosmetic. It changes no behavior.

`vcs.useIgnoreFile: true` needs a real `.gitignore` file. Compose therefore
bind-mounts `.gitignore` into `bun-dev` with the other source paths. Without
that file, `biome check` fails in the container. Tests confirmed this. It
does not skip the exclusion quietly.

## Architecture

The repository has these top-level parts:

- `server/` holds the Bun backend.
- `client/` holds everything that the HTML-import bundler of Bun processes.
- `scripts/` holds the operations tools.
- `tests/` holds the tests.

The project configuration files stay at the root. These are `Dockerfile`,
`docker-compose.yml`, `justfile`, `package.json`, `tsconfig.json`,
`biome.json`, and `.env.dist`.

- **`server/server.ts`** — the whole backend. It is built around `Bun.serve()`:
  - `import index from '../client/index.html'` — the HTML-import bundling of Bun parses `index.html`. It finds the linked `client/style.css`, the linked `client/script.ts`, and the other assets. It bundles all of them. Bun alone selects the bundling mode. It reads the `NODE_ENV` variable. A value of `production` selects production bundling: minified, cached, hashed filenames. Any other value selects development bundling: on demand, unminified, with hot module replacement. `server.ts` holds no branch of its own for this.
  - The `routes` table: `'/'` and the wildcard `'/*'` both serve the `index` HTML bundle. The wildcard is the fallback in the style of a single-page application. It catches a path with an upload hash, such as `/abc12`. The client reads that hash from `location.pathname`. The server does not route it. You cannot wrap these two routes for logging. Bun accepts the HTML bundle value only by direct assignment, as in `'/': index`. A route handler function cannot return it. A function return gives a placeholder response instead, with no error. Tests confirmed this against Bun 1.3.14. Every other route is a plain function. The logger records all of those.
  - `'/upload'` has a `POST` handler. It reads the file with `req.formData()`. Bun parses the multipart body natively. The project needs no `multer`. The handler runs three checks in order. First it requires a `Blob` with a `file.type` of exactly `image/png`. Second it enforces `MAX_UPLOAD_SIZE` (15MB). Third it calls `hasPngSignature()`, which compares the first 8 bytes against the PNG magic number. That third check is the real gate. `file.type` is only the Content-Type that the client declares, so a raw `POST` can spoof it. The stored file later reaches the native image decoder of the export renderer, so bad bytes must never land on disk. The size limit is generous on purpose. `$toCanvas()` renders at the resolution of the source image. It does not render at the display size of the crop zone. A large source photograph can therefore make a large PNG file.
  - `generateUploadHash()` names the stored file. `randomHash()` builds the name from `HASH_CHARS` with `randomInt` from `node:crypto`. The project uses no `randomstring` dependency any more. `HASH_LENGTH` sets the length. The function retries up to `MAX_HASH_ATTEMPTS` (5) times on a collision with an existing file. It then accepts the last name and overwrites. The collision odds are about 1e-8 at the default length. `Bun.write()` writes the file into `uploads/` as `<hash>.png`. The handler then redirects to `/<hash>`.
  - The preview dialog of the client always crops the image. It also re-encodes the image through a `<canvas>` element. It does this for every source format. PNG is therefore the only type that a legitimate upload sends. See `client/preview.ts` below. `resolveUpload()` looks for `<hash>.png` only. An older fallback also resolved other extensions. It resolved bare names with no extension too. Every upload from before the PNG restriction aged out under `UPLOAD_RETENTION_DAYS`. The code therefore dropped that fallback. A rejection redirects to `/?error=<reason>`. The reason is `invalid_type` or `too_large`. A bare `/` would hide the cause. The client shows a specific message instead. It does not fail silently.
  - `'/uploads/*'` serves files from `uploads/` with `Bun.file()`. `'/img/*'` serves `client/public/img/`. This route is necessary because `script.ts` names `img/doge.png` at runtime as a plain string. The bundler cannot analyze that string. It therefore cannot handle the file as it handles the video, the CSS, and the JavaScript. `'/videos/*'` serves `client/public/videos/`. The cause here is different. The bundler processes `<video><source src>`. The bundler does not process a `<track src>` on the same element. Tests confirmed this. The bundler rewrites the path of the `<source>` to a hashed `/_bun/asset/...` URL. The bundler leaves the path of the `<track>` alone. The captions `.vtt` file therefore needs its own manual route. All three routes call `serveFrom()`. Tests verified its protection against `../` path traversal. Plain, percent-encoded, and double-encoded attempts were all blocked. The protection depends on `new URL().pathname`. That property normalizes the dot segments before the code slices the path. Do not replace it with a match on the raw `req.url` string. Verify the protection again first.
  - The server sets a few security headers on every response that it builds. These are `X-Content-Type-Options`, `X-Frame-Options`, and a basic CSP. The project needs no `helmet` dependency for this. The HTML bundle routes `'/'` and `'/*'` do not get these headers. The HTML-import routing of Bun has no documented way to attach custom headers to them.
  - `log()` is a small wrapper around `console.log`. It adds a timestamp. It records the startup information. It records every upload attempt. A success line holds the filename, the type, and the size. A rejection line holds the reason. It records every static file serve and every 404 under `/uploads/*`, `/img/*`, and `/videos/*`. It also records uncaught errors, through the `error` hook of `Bun.serve`. The two HTML bundle routes are the one place with no per-request log, for the reason above.
  - Bun loads `.env` files natively. The project needs no `dotenv`.
  - `uploadsDir` resolves relative to the location of `server.ts`. The `/img/*` folder (`${import.meta.dir}/../client/public/img`) does the same. The `/videos/*` folder (`${import.meta.dir}/../client/public/videos`) does the same. `uploads/` and `client/` are siblings of `server/`. They are not inside it.
  - The code keeps the return value of `Bun.serve()` as `const server`. It also exports it as the default export. Only `tests/server.test.ts` needs this. The test calls `fetch()` against the server directly, in the same process. `server.ts` does not use the value itself.
  - `'/export/*'` renders the shooting-stars animation on the server. `server/export.ts` holds this code. It uses `@napi-rs/canvas` and one `ffmpeg` process. It needs no headless browser. See `server/keyframes.ts` below for the animation data. `parseExportOptions()` reads four query parameters: `orientation`, `resolution`, `fps`, and `format`. It falls back to a default for any value outside the allowed set. The defaults are `landscape`, `480p`, `24`, and `mp4`. The allowed sets live in `client/export-options.ts`. See that bullet below.
  - The three export formats are MP4, WebM, and GIF. MP4 holds H.264 video and AAC audio. The encoder copies that audio straight from `background.mp4`. WebM holds VP8 video and Vorbis audio. The encoder re-encodes both of them, because WebM cannot carry AAC. WebM encodes much slower than MP4. VP8 is slower than `libx264 -preset ultrafast`. This stays true with `-deadline realtime -cpu-used 8`. GIF is the slowest of the three. It carries no audio. It needs a `palettegen` pass and a `paletteuse` pass for acceptable quality. Its filter graph, its map arguments, and its tail arguments therefore differ from the two video formats. `paletteuse` runs a Bayer dither at `bayer_scale=5`. The default `sierra2_4a` dither measured about 29% larger with no visible quality gain.
  - GIF also takes its own caps, through `clampForGif()`. The caps are 480p and 24fps. The server applies them in `parseExportOptions()`, not the client alone. A direct request could otherwise pass them. An uncapped GIF at 1080p and 60fps measured about 146s and about 324MB. WebM at the same settings measured about 20s and about 6MB. The renderer applies no automatic downscale beyond that cap. The client shows a real size estimate first instead. See `client/export.ts` below.
  - `idleTimeout` is 60 seconds. The Bun default of 10 seconds is too short. The server streams nothing. It sends one `Response` after the whole render, so the render duration counts against the timeout. A module-level `exportInProgress` flag is a single-slot lock. A second request during a render gets a 429 status. A real job queue is not worth the code for how rarely two exports overlap. The response carries a `Content-Disposition` filename of `<hash>.<format>`, or `doge.<format>` for the default image. A fixed name would make two exports collide on disk.
  - `renderExportInWorker()` runs the render on a separate operating system thread. `server/export-worker.ts` is that thread. The render does not run on the thread of `Bun.serve`. The per-frame drawing of `@napi-rs/canvas` is synchronous native CPU work. The `ffmpeg` subprocess is already off the thread, through `Bun.spawn`. Without a worker thread, a render would block every other request for its full duration. Page loads, uploads, and progress polls would all stop. Tests confirmed the correction: `GET /` still answers in about 1 ms during a render. The worker reports back with `parentPort.postMessage()`. It sends progress ticks. It then sends a final `done` message or `error` message. It does not return a value. The main thread lets the worker exit by itself. A forced `worker.terminate()` raced that natural exit. It also printed a false Bun warning about "ObjectRef is not unref" on every export.
  - `'/export-status'` reports `{ inProgress, percent }`. Module-level state holds these values. The `onProgress` callback of `renderExport` updates them once per rendered frame. `client/export.ts` polls this route during a render. It drives a `<progress>` bar with the result. The bar lives in a modal `<dialog>` element, `#export-progress-dialog`. The client opens it with `showModal()`. A plain spinner would show no real progress. The modal also makes the rest of the page inert during a render. The code calls `preventDefault()` on the `cancel` event of the dialog. The Escape key therefore cannot close the dialog during a render. The project supports no cancel of a render in flight. This route is a top-level path on purpose. It is not under `/export/`. It can therefore never collide with the wildcard hash match of that route. The per-frame progress stops at `FRAME_PROGRESS_CAP` (95), not at 100. `ffmpeg` still encodes after the last frame arrives, and the GIF palette passes run long after that point. `renderExport()` reports the real 100 after the process exits.

- **`server/keyframes.ts`** — the canonical animation dataset. The export renderer reads it. `scripts/generate-stars-css.ts` also reads it to write `client/css/stars.css`. Each entry in `ANIMATIONS` is a `PictureAnimation`. It holds one control-point array per property: `x`, `y`, `scaleX`, `scaleY`, `rotateDeg`, `opacity`, and `filter`. It also holds a `transformOrder` value of `"scale-rotate"` or `"rotate-scale"`. That value records the order of the CSS transform functions for that one animation. `stars.css` is not consistent here. `spaceone` and `dolphins-two` write `translate() scale() rotate()`. The other animations write `translate() rotate() scale()`. CSS composes transform functions in written order. The canvas rendering in `server/export.ts` must therefore follow the order of each animation. One fixed order is not correct. A control point can carry `implicit: true`. This flag marks a synthetic identity value. The linear interpolation in `resolvePictureFrame()` needs a boundary to interpolate from. For example, the transform and the filter of `spacetwo_3` start at 50% in the source CSS. The leading 0% point exists only for the arithmetic. `interpolate()` and `interpolateFilter()` ignore the flag. `scripts/generate-stars-css.ts` reads the flag. It then omits that property at that percentage. Edit this file directly. Do not edit `stars.css`. Run `just generate-css` after an edit. `just check` fails otherwise. See Linting/formatting above.

- **`server/export-worker.ts`** — the entry point of the worker thread. `renderExportInWorker()` in `server/export.ts` starts it. See above. It is a thin wrapper, not a second implementation. It reads its job from the `workerData` of `worker_threads`. The job holds `imagePath`, `orientation`, `format`, and `dir`. It calls the same `renderExport()` that the direct path calls. It reports back with `parentPort.postMessage()`. The result of a worker is a message, not a return value.

- **`client/index.html`** — the entry point for the HTML import of Bun. It holds the whole page as static markup: `#starfield`, the `<video>` element, the hidden upload `<form>`, the `#quick-actions` dock, the `#landing` console, the `#upload-error` toast, three `<dialog>` elements, `#pictures-container`, and the footer. The three dialogs are `#preview-dialog`, `#export-options-dialog`, and `#export-progress-dialog`. `client/script.ts` creates only the 6 `<img>` elements. Every other element already exists here, which is why the TypeScript modules cast their DOM lookups instead of checking for null. The `<head>` also carries the Open Graph tags. `og:image` points at an absolute `https://shooting-stars.tekrop.fr/img/preview.jpg` URL, because a social crawler cannot resolve a relative one.
  - It links `./style.css` and `./script.ts` with plain relative paths. Both files are siblings in the same folder. It links the background video as `./public/videos/background.mp4`. This real relative path lets the bundler find the file. The bundler then copies the file and rewrites the URL. A `/videos/background.mp4` path instead makes the bundler treat the file as a module. That attempt fails. The favicon `<link>` looks like an asset tag. The bundler does not process it at all. It therefore keeps a plain server-relative `/img/favicon.png` href. The `/img/*` route serves it. The video carries `<track kind="captions" src="/videos/background.vtt">`. This tag satisfies `a11y/useMediaCaption`. See Linting/formatting above. It is the same story as the favicon. It uses a plain server-relative href, not a bundler-relative `./` path. The `/videos/*` route serves it. See `server.ts` above. The captions file holds only a `WEBVTT` header and no cues. The video has no dialogue to transcribe. The video does play quiet audio. `animation.ts` sets `video.volume = 0.05`. A `muted` attribute is the other exemption of the rule. It is therefore not an option here.

- **`client/script.ts`** — the page bootstrap. It uses no bundler-specific API. The page loads it as an ES module, through `type="module"`. It imports its sibling modules. It reads the current URL path. A `/` path shows `img/doge.png`. Any other path is an upload hash. The file then points all 6 `<img>` elements at `uploads/<hash>`. It creates those 6 elements itself, with the ids `pict1` through `pict6`. This file also owns the focus class trick for the upload control. `#file-upload` has two labels in different parts of the DOM. It therefore cannot use the adjacent-sibling focus selector of CSS. See `body.file-upload-focused` in `client/css/buttons.css`. It also runs the three initializers: `initPreviewDialog(applyUploadedImage)`, `initExport()`, and `initVolumeControl()`. `applyUploadedImage()` is the upload callback. A successful upload runs it. The callback swaps the `src` of the 6 pictures. It pushes the new `/<hash>` URL with `history.pushState()`. It then calls `startAnimation()` from `client/animation.ts`. The page never reloads. The choreography engine lives in `animation.ts`, not here. This file only imports and calls `restartAnimation()` and `startAnimation()`. This file also owns two small pieces of page chrome. It writes the application version into the footer, from the `version` field of `package.json`. It also owns the `#copy-link-btn` handler. That handler writes `location.href` through `navigator.clipboard`. It reports a missing clipboard API and a denied permission as two separate messages. Clipboard access needs a secure context, so both cases happen in practice.

- **`client/animation.ts`** — the shooting-stars choreography engine. It was part of `script.ts` before. It is a self-contained concern: the launch prompt gate plus the timed picture and video sequence. It owns its own DOM references: `video`, `landing`, `starfield`, and `tap-to-play`. It owns its own module state: `animationTimeouts` and `launchListenersAttached`. None of this belongs to the one-time bootstrap work in `script.ts`. The loop in `startAnimation()` drives off `ANIMATION_TIMELINE`. It imports that value from `client/animation-timeline.ts`. See below. This module and the export renderer of the server therefore read the same stage timeline. The DOM lookups use `as Type` casts, such as `document.getElementById('video') as HTMLVideoElement`. They use no defensive null check. These elements are static. `index.html` always holds them. A cast is correct here. A bare `!` assertion is not. `noNonNullAssertion` is on, and it flags only the assertion. See Linting/formatting above. `#tap-to-play` is the only element wired to `startAnimation()`. It is a real `<button>` element, not `window`. A click, a tap, or a keyboard press on that one element is the only launch path. The listener needs no target filter. Nothing else can reach it. The module exports `restartAnimation` and `startAnimation` for `script.ts`. It wires the `'ended'` listener of `video` to `restartAnimation` itself, at module load. That listener belongs to the lifecycle of this module, not to the bootstrap.

- **`client/animation-timeline.ts`** — pure data. It touches no DOM. It exports the `AnimationStage` type. It exports `ANIMATION_TIMELINE`. That map turns millisecond offsets into a stage class plus the list of visible `pictN` ids. This file was part of `animation.ts` before. The split lets `server/export.ts` import the timeline alone. `animation.ts` calls `document.getElementById(...)` at the top level. Those calls throw outside a browser, for example under `bun test`. Keep the timings of this map in step with the runtime of `videos/background.mp4`. Keep them in step with the animation durations in `client/css/stars.css` too. You must do this by hand. No file derives its values from another.

- **`client/preview.ts`** — the preview dialog that runs before an upload. It has three steps: `source`, `crop`, and `edit`. `setStep()` owns the visible state of all three plus their navigation buttons. The source step accepts a file in three ways: a drag and drop on `#source-drop-zone`, a Ctrl-V paste into the dialog, or the `#source-browse-btn` button. That button clicks the hidden `#file-upload` input. A touch-first device reaches none of the first two, so the `.upload-trigger` buttons skip the source step there and click the file input directly. The `isMobile` test needs two media queries together: a coarse primary pointer with no hover, and no fine pointer under `any-pointer`. The second query keeps a touchscreen laptop with a mouse on the desktop path. `client/export.ts` repeats this same test for its default orientation. The crop step uses [`cropperjs`](https://github.com/fengyuanchen/cropperjs) v2. That version is the rewrite with Web Components. `new Cropper(image, { container })` renders a tree of custom elements under `<cropper-canvas>`. It is not one widget. The code drives it through the instance API with the `$` prefix: `$ready`, `$center`, `$scale`, `getCropperSelection()`, `$change`, and `$toCanvas`. It does not use DOM attributes. The crop step sizes the image to `IMAGE_FIT_SCALE` (80%) of the crop zone on init. It calls `$center('contain').$scale(...)` for this. It then calls `$change()` on the selection at once. The new bounds match the rendered bounds of the image exactly. The code reads both with `getBoundingClientRect()`, on the image and on the canvas. The `initial-coverage` option of cropperjs sizes the selection against the *canvas*, not the image. Without this correction, a full-coverage selection would also take the empty letterbox margin. That margin becomes extra transparent space. This happens whenever the aspect ratio of the image differs from the aspect ratio of the crop zone. `(getCropperSelection() as CropperSelection).$toCanvas()` renders the crop result into `#edit-canvas`. It then hands off to `initTransparencyTools()` for the second step. See below. The upload always sends `cropped.png` through `fetch('/upload', ...)`. This is true even when the user skips the transparency tools. The server accepts PNG only. See `server.ts` above. `fetch` follows the 303 redirect itself. The code therefore reads the result from the final `res.url` and `res.status`. It does not read the redirect header. A path in the shape of a hash means success. The dialog then closes. The `onUploaded(hash)` callback then runs. The page does not navigate. Three cases mean failure: a bare `/` path with an `error` query parameter, a status of 500 or more, and a rejected `fetch` from a network failure. Each case closes the dialog. Each case then shows a message for that reason, through `#upload-error`. That element is a toast. The user can dismiss it. It also times out by itself. See `UPLOAD_ERROR_MESSAGES`. The page does not reload. The failure is never silent.

- **`client/transparency.ts`** — the optional second step of the dialog. It offers two tools. The erase tool drags a brush. It draws with `globalCompositeOperation: 'destination-out'`. The color-pick tool takes one click on a pixel. It then clears every pixel within a tolerance. The tolerance is a Euclidean distance in RGB space. That tool works through `ImageData`. Both tools share one stack of undo and redo steps. Each step is an `ImageData` snapshot. `MAX_HISTORY` caps the stack. The code takes one snapshot per `pointerdown` event. A whole drag is therefore one undo step. It is not one step per brush mark. `initTransparencyTools()` returns a `reset()` function. `preview.ts` calls it for each new crop in `#edit-canvas`. The call clears the tool state and the history.

- **`client/export.ts`** — the client half of the export feature. `initExport()` wires `#export-btn` in the dock. That button opens `#export-options-dialog`. The dialog holds four option rows: orientation, resolution, frame rate, and format. Each row is a group of buttons with a `data-value` attribute. `selectOption()` and `getSelected()` read and write the `aria-pressed` state of a group. Both are generic over the value type of the row, so a caller gets a typed value back with no `as` cast. The default orientation follows the device type, not the current viewport: portrait on mobile, landscape elsewhere. It uses the same `isMobile` test as `client/preview.ts`. It is a deliberate product choice. The user can still change it.
  - `applyGifCap()` runs after every option click. It disables each resolution button and frame rate button above the GIF cap while GIF is selected. It also moves the current selection down through `clampForGif()`, the same function the server enforces with. The two sides therefore cannot disagree on the cap. `updateGifWarning()` shows a real size estimate in `#gif-size-warning`. `GIF_SIZE_ESTIMATE_MB` holds measured sizes for the four allowed pairs, from 17MB up to 42MB. The orientation does not change the pixel count, so one entry covers both. A warning with a real number replaces a silent server-side downscale.
  - `runExport()` disables the button, opens `#export-progress-dialog`, and polls `/export-status` every 200 ms. The progress label reads "Finalizing…" between `FRAME_PROGRESS_CAP` and 100. A frozen percentage would read as a broken export. A successful response becomes a `Blob`. An `<a download>` element with an object URL starts the save. A failed response shows a message keyed by HTTP status, through the same `#upload-error` toast that `preview.ts` uses. That element is a generic dismissible message despite its id.

- **`client/export-options.ts`** — the export option types, constants, and logic. It holds `Orientation`, `Resolution`, `FrameRate`, `ExportFormat`, `RESOLUTION_ORDER`, `GIF_MAX_RESOLUTION`, `GIF_MAX_FPS`, `clampForGif()`, and `FRAME_PROGRESS_CAP`. `server/export.ts` imports this file across the client boundary, the same way it imports `client/animation-timeline.ts`. It then re-exports the whole file with `export *`, so the `from "./export"` imports in `server.ts` and `export-worker.ts` need no change. This file has no dependency at all. It touches no DOM. It calls no Bun API and no Node API. It is therefore safe in the browser bundle and under Bun. One copy here is what stops the GIF caps and the clamp logic from drifting between the two sides. 720p is the highest tier because `background.mp4` is itself 1280x720. A 1080p export would only upscale the background.

- **`client/volume.ts`** — the volume control in the `#quick-actions` dock. `initVolumeControl()` reads the `<video>` element through `getVideoElement()`, exported by `client/animation.ts`. No second `document.getElementById("video")` call exists. The slider starts from the value that `animation.ts` already set (`video.volume = 0.05`), rather than a second default that could drift. `#volume-btn` opens a small popover, `#volume-menu`. An outside click closes it. The Escape key closes it too, from any focused element inside. `isMuted()` treats a volume of 0 and the `.muted` flag as the same state, because both play silently. A drag on the slider always unmutes, which matches a native media player.

- **`client/style.css`** — a thin manifest. It is not a stylesheet in its own right. It declares the cascade layer order: `@layer base, components, dialog, stars, responsive;`. It then imports each domain file below from `client/css/`. `index.html` still links this one file as `./style.css`. The bundler of Bun (Lightning CSS) resolves the imports. It inlines them into one bundled stylesheet at serve time. Tests confirmed this in the development mode output. It is not an assumption. The layer order is the important part here. A rule in a later layer beats a rule in an earlier layer. Selector specificity does not change that. Source order does not change that either. `css/responsive.css` is last. It can therefore override `css/buttons.css` and `css/landing.css` in the `components` layer. It never has to fight ID specificity against class specificity.
  - **`client/css/base.css`** (`layer: base`) — the global page chrome. This chrome is present on every screen. It covers the `:root` theme variables, the `html` and `body` reset, `#starfield`, the `video#video` background element, `#pictures-container`, and the persistent `footer`.
  - **`client/css/buttons.css`** (`layer: components`) — the shared button chrome. The landing screen uses it. Playback also uses it. It covers `.console-btn` with its `--primary` and `--secondary` variants, `#quick-actions`, `.dock-btn`, the hidden `#file-upload` input, and the focus ring trick of that input.
  - **`client/css/landing.css`** (`layer: components`) — the idle-state user interface: `#landing`, `.console-card` with its contents, and `#upload-error`.
  - **`client/css/dialog.css`** (`layer: dialog`) — all three `<dialog>` elements. It covers the upload preview dialog with its source step, crop step, and edit step. It also covers `#export-options-dialog` and `#export-progress-dialog`. Both reuse the transparent host and the blurred backdrop of `#preview-dialog`. Shared pieces are `.tool-picker`, `.option-row`, `.slider-control`, and `.preview-actions`. The two export dialogs are declared before the `& > .tagline` rule of the preview steps. This order satisfies the static specificity check of Biome. See Linting/formatting above.
  - **`client/css/stars.css`** (`layer: stars`) — the shooting-stars animation itself. It expresses the animation as native CSS `@keyframes` rules, one set per stage. The stages are `init`, `spaceone`, `dolphins`, `spacetwo`, `microone`, and `microtwo`. Each stage has one keyframe variant per picture, for example `spacetwo_1` through `spacetwo_6`. Each variant has a different transform and a different timing. The images therefore do not move identically. **A script generates this file.** Do not edit it by hand. `scripts/generate-stars-css.ts` writes it from the `ANIMATIONS` data in `server/keyframes.ts`. Edit that data. Then run `just generate-css`. `just check` regenerates the file in `--check` mode. It fails the build when the two files have drifted apart. A change to an animation duration also needs a change to `ANIMATION_TIMELINE` in `client/animation-timeline.ts`. Update the matching offsets there by hand. The durations and the stage timings do not derive from each other.
  - **`client/css/responsive.css`** (`layer: responsive`, last) — the media queries: `prefers-reduced-motion`, `max-width`, and `orientation`. It stays as one file. The queries already cross-cut `console-btn`, `dock-btn`, `footer`, and `console-card`. A split into per-component files would hide the "these are the overrides" model. Its largest block turns `#preview-dialog` fullscreen and opaque on a touch-first device. That block also hides `#starfield`, whose endless keyframes over a 7-layer radial gradient cost a mobile GPU a real repaint. It also overrides the browser default size cap on `dialog:modal`, which was the source of a scrollbar problem, and sizes `#edit-canvas` with `flex: 1` plus `object-fit: contain` so the bitmap keeps its aspect ratio inside a flexible box.

  All of these files use native CSS nesting, such as `&:hover` and `&.hide`. The bundler of Bun (Lightning CSS) supports this directly. The project needs no preprocessor. The styles were one LESS file at the start. The project converted them to plain CSS. The bundler of Bun does not support LESS. The only true LESS features in use were a few compile-time arithmetic values in the `init` keyframes. Those values used `@variable` names. They are now literal values.

- **`client/public/img/doge.png`** — a manual route serves this file, not the HTML bundler. The code names it dynamically. See `script.ts` above. `client/public/` also holds `favicon.png` and `preview.jpg`. Manual routes serve them for the same reason. It holds `videos/background.vtt` too. A manual route serves that file because the bundler ignores `<track>`. See `index.html` above. It also holds `videos/background.mp4`. The bundler does process that file. See `index.html` above.

- **`uploads/`** — the runtime file store. Git ignores it. It sits at the project root. It is a sibling of `server/` and `client/`. It is not inside either one. It holds runtime data, not source. Docker mounts it as a bind volume. The host path comes from `${UPLOADS_DIR}`. `docker-compose.yml` defaults that to `/tmp/shooting-stars-uploads`. Point it at a real persistent path for production. The mount keeps the uploads across a container recreation. The `bun`, `bun-dev`, and `cleanup` services share it.

- **`scripts/generate-stars-css.ts`** — generates `client/css/stars.css`. It reads the `ANIMATIONS` data in `server/keyframes.ts`. See above. Run `bun run generate:css` or `just generate-css` to write the file. Run `bun run generate:css` with `--check` to compare instead. That mode compares the generated text against the file on disk. It exits non-zero. It writes nothing. The `verify:css` script wraps that mode. `bun run check` and `just check` both run it. This check is what stops the two files from drifting apart. Byte-identical output is not the goal. `just format` reformats the file through Biome anyway. Equal behavior is the goal. For example, the generator always emits the two-argument `scale(x, y)` form. The original hand-written `stars.css` used `scale(n)` or `scaleX(n)` in places. Both forms compute the same result. `docker-compose.yml` must bind-mount `./scripts` into the `bun-dev` service, next to `server` and `client`. `just check` and `just generate-css` both run in that container.

- **`scripts/clean_old_uploads.sh`** + **`scripts/Dockerfile`** — the upload retention job. It runs in a container. It no longer needs host cron. The script wraps one command: `find "$PATH_TO_UPLOADS" -type f -ctime "+$UPLOAD_RETENTION_DAYS" -delete -print`. It counts the printed lines. It then logs a timestamped `deleted N file(s)...` summary for each run. `docker logs` shows that summary. `docker compose logs cleanup` shows it too. `PATH_TO_UPLOADS` defaults to `/uploads`. That path is the fixed mount point inside the cleanup container. Do not override it through `.env`. `UPLOADS_DIR` controls the host side of the same mount. `UPLOAD_RETENTION_DAYS` defaults to `30`. The script reads it under the same name that `.env` uses. No layer in the chain renames it. `-type f` also keeps `find` off the `/uploads` mount point directory itself. This holds true even when every upload ages out at once. The `cleanup` service reads `.env` through `env_file:`, as `bun` and `bun-dev` do. It does not copy single variables into an `environment:` block. `scripts/Dockerfile` builds a small image from `alpine:3` plus `findutils`. The `find` command of alpine comes from busybox. That version does not support `-ctime`. The entrypoint is a `while true; sleep 1d` loop around the script. This is a deliberate shortcut over a real `crond` entry. The project has exactly one daily job. Change to `crond` when a real schedule becomes necessary, for example a specific time or several jobs. `docker-compose.yml` holds this as the `cleanup` service. It uses the default profile. It runs next to `bun` in production. Its restart policy is `unless-stopped`.

- **`Dockerfile`** — builds on `oven/bun:1`. That image is Debian, not `-alpine`. The header comment of the file gives the reason. Bun has a libc detection fault on Alpine. That fault already broke `lightningcss`. It would break `@napi-rs/canvas` too. The working directory is `/app`. The `base` stage installs ffmpeg. It also copies the package manifest. The `deps` stage runs `bun install --frozen-lockfile`. It keeps the full devDependencies. It feeds the `dev` target. `just check` and `just test` run against `bun-dev`. Those commands need `typescript` and `@biomejs/biome`. The `deps-prod` stage runs `bun install --frozen-lockfile --production`. It is a sibling stage. It supplies `node_modules` to the final image only. The devDependencies therefore never reach production. The final stage has no target name. It copies that `node_modules` in. It also copies `tsconfig.json`, `server/`, and `client/`. It runs `bun server/server.ts` with `NODE_ENV=production`. Bundling and minification happen at runtime, on demand. The project needs no build stage. It needs no `dist/` artifact.

- **`docker-compose.yml`** — holds three services. `bun` runs production. It uses the default profile. Its healthcheck runs `bun -e` with a `fetch()` call. The `oven/bun:1` image carries no `wget` and no `curl`, unlike the old Alpine image, and one healthcheck does not justify another package. `bun-dev` uses the `dev` profile. It builds the `dev` target of the Dockerfile. It bind-mounts `server/`, `client/`, `scripts/`, `tsconfig.json`, `biome.json`, `package.json`, `.gitignore`, and `tests/` for live editing. `just check`, `just format`, and `just test` also run against this service, each as a one-off `docker compose run`. They therefore always read the current working tree. They never read the last image build. `cleanup` uses the default profile. It builds `scripts/`. It runs the upload retention job. The port map of `bun` and `bun-dev` is `"${APP_PORT:-9595}:9595"`. Only the host side takes a value from `.env`. The container side is always `9595`. That value matches the fixed port in `server.ts`. The bind mount path of `UPLOADS_DIR` is also a `${VAR:-default}` expansion, not a fixed value.

- **`tests/server.test.ts`** — runs `bun:test` against the real `server/server.ts`. It imports the server directly. The port of the server is fixed at `9595`. Each `bun test` run happens in its own throwaway container, through `docker compose run`. That container publishes no ports. A test run therefore never collides with a running `bun` service or `bun-dev` service. The route tests cover these cases: `/` loads; a PNG upload redirects to a `/<hash>` URL that itself loads; the server rejects a non-image upload back to `/`; the server rejects a non-PNG image upload back to `/`; the server rejects a file that declares `image/png` but carries other bytes; a hash that nobody uploaded gives a 404 under `/uploads/*`; the security headers are present on `/uploads/*` responses; `/img/*` serves the default doge image; `/videos/*` serves the captions file of the background video.
  - The export tests run real end-to-end renders. They mock out neither `ffmpeg` nor the canvas, because the speed of a real render is the point of the feature. They cover MP4, WebM, GIF, a non-default resolution, the `doge` fallback filename, the hash-based filename, the 429 from a second concurrent export, and `/export-status` both idle and during a render. The GIF cap test asks for 720p at 60fps and expects a fast answer, which proves `clampForGif()` runs on the server. A test that needs a real hash uploads the true `doge.png` bytes through `uploadDoge()`, because an export decodes the file with `loadImage()` and a placeholder PNG fails there. `afterAll` removes every file that the tests write to `uploads/`.

- **`tests/keyframes.test.ts`** — covers the pure animation arithmetic with no HTTP and no render. It tests `interpolate()` and `resolvePictureFrame()` from `server/keyframes.ts`, including the identity boundary, the mid-segment case, and the wrap around `durationMs`. It also tests the helpers that `server/export.ts` groups under `testInternals`: `travelScale`, `pictureBox`, `findStage`, `cssFilterString`, `renderFilterChain`, `renderFilterComplex`, and `buildFilterComplex`. Those helpers are pure and do no input or output. They are exported under one name so the real public API of the module stays separate.

- **`tests/animation-timeline.test.ts`** — two guards on `client/animation-timeline.ts`. The first checks the offsets that `buildTimeline()` computes against the original hardcoded numbers. The second checks that every picture visible in a stage has a matching `ANIMATIONS` entry, through `pictureAnimationKey()`. The second one is what catches a rename or a renumbering that splits the CSS from the export data.

## Notes

- The upload filter runs three checks: the declared MIME type must be exactly `image/png`, the size must be under `MAX_UPLOAD_SIZE`, and the first 8 bytes must be the PNG magic number. It does not check the extension. It does not parse the rest of the file.
- The application always listens on `9595`. Only the publish port on the host can differ. The `APP_PORT` variable sets it. The current Compose setup binds it to localhost only.
- The `cleanup` service deletes old uploaded files each day. It deletes files older than `UPLOAD_RETENTION_DAYS`. The default is 30 days. See `scripts/` in Architecture above.
- Only one export can run at a time. A second request gets a 429 status. The lock is a module-level flag in `server/server.ts`, so it does not survive a restart.
- The animation timings live in three places that nothing derives from each other: `ANIMATION_TIMELINE` in `client/animation-timeline.ts`, the `durationMs` values in `server/keyframes.ts`, and the runtime of `videos/background.mp4`. Keep them in step by hand.

## Writing style

Write code comments, commit messages, project documentation files such as
this one, and chat responses to the user in ASD-STE100 Simplified Technical
English. Do not use this style for code, file paths, or identifiers. Follow
these rules exactly:

- Keep each sentence to 20 words or fewer.
- Write one instruction or one fact per sentence. Do not join two facts with "and", "or", or a comma.
- Use active voice. Name the actor. Do not write "the event can be lost"; write "focus loss can drop the event".
- Use plain, common words. Do not use slang or informal words, for example "spam" or "wiggle".
- Do not use contractions. Write "do not", not "don't".
- Keep noun clusters to 3 words or fewer. Add an article or a preposition to break up a longer string of nouns.
- Do not just append a new sentence to an existing comment. Revise the whole comment. Check it against every rule above again. Cut it back to 2 to 3 lines.
- The 2 to 3 line target applies to each comment. Keep the reason, not the history. State why the code is this way. Do not list every option that somebody rejected. Move a long explanation into this file instead, then point at it from the code.

Example, before and after:

```ts
// Before: passive voice, one 33-word run-on sentence, informal word "wiggle".
// The release event can be lost, for example when the window loses focus
// mid-drag. Recover here, or the card stays raised and stuck to the last
// mouse position forever, with the button no longer down.

// After: two short active-voice sentences, plain words.
// A focus change can drop the release event. This check ends the drag
// when the button is already up.
```

Check every new or changed comment against these rules. Do this at the same
time as `just check`. Do this before you call a code change done.

## Contributing

Commit messages **must** follow
[Conventional Commits](https://www.conventionalcommits.org/). The form is
`type(scope): subject`, for example `fix: correct upload hash length`. This
rule is not only style.

`.releaserc.json` runs `semantic-release`.
`.github/workflows/release.yaml` starts it on every push to `main`. It uses
the default `@semantic-release/commit-analyzer` with the Angular preset. The
analyzer parses the commit types. It then decides whether to cut a release.
It also decides the version step:

- `fix:` gives a patch release.
- `feat:` gives a minor release.
- A `BREAKING CHANGE:` footer gives a major release. A `!` marker does the same.
- Other types, such as `chore:`, `docs:`, and `refactor:`, give no release.

The analyzer then writes the `CHANGELOG.md` entries from those same messages.

The analyzer ignores a commit message that does not follow the convention. It
raises no error. The practical failure is therefore a silent one. The change
lands with no version step and no changelog entry. The build does not break.

Run `just check` and `just test` before you open a pull request. See Commands
above. CI runs the same checks, through `.github/workflows/build.yml`.
