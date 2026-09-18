# CLAUDE.md

This file gives guidance to Claude Code (claude.ai/code). Read it before you
work with code in this repository.

## What this is

This project is a single-page site. It recreates the "shooting stars" meme.
A background video plays. Up to 6 images fly across the screen. The images
move in time with fixed animation keyframes. The user uploads the images.
The site shows the default doge image when the user uploads nothing.

The site can also export the animation as a video file. The server renders it
with a native canvas and `ffmpeg`. It uses no headless browser. The output is
MP4, WebM, or GIF. See `server/CLAUDE.md`.

## Commands

Docker is the preferred workflow. Use `just`. Run `just --list` for the recipes.
Run `just check` and `just test` before a pull request. Both run in the dev container.

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
`client/CLAUDE.md`. The rule flags a selector of low specificity after a
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

- **`server/`** — the Bun backend. See `server/CLAUDE.md` for the routes, the upload checks, and the export renderer.
- **`client/`** — the browser code and the CSS. See `client/CLAUDE.md` for the modules and the cascade layers.
- **`scripts/generate-stars-css.ts`** — writes `client/css/stars.css` from `server/keyframes.ts`. `docker-compose.yml` must bind-mount `./scripts` into `bun-dev`, next to `server` and `client`. `just check` and `just generate-css` run in that container.
- **`scripts/clean_old_uploads.sh`** — the upload retention job. Do not override `PATH_TO_UPLOADS` through `.env`. It is the fixed mount point inside the `cleanup` container.
- **`Dockerfile`** — builds on the Debian image `oven/bun:1`, not on Alpine. Bun has a libc detection fault on Alpine. That fault broke `lightningcss`. It would break `@napi-rs/canvas` too.
- **`tests/`** — the export tests run real renders. They mock neither `ffmpeg` nor the canvas. A test that needs a real hash uploads the true `doge.png` bytes through `uploadDoge()`. A placeholder PNG fails in `loadImage()`.

## Notes

- The upload filter runs three checks: the declared MIME type must be exactly `image/png`, the size must be under `MAX_UPLOAD_SIZE`, and the first 8 bytes must be the PNG magic number. It does not check the extension. It does not parse the rest of the file.
- The application always listens on `9595`. Only the publish port on the host can differ. The `APP_PORT` variable sets it. The current Compose setup binds it to localhost only.
- The `cleanup` service deletes old uploaded files each day. It deletes files older than `UPLOAD_RETENTION_DAYS`. The default is 30 days. See `scripts/` in Architecture above.
- Only one export can run at a time. A second request gets a 429 status. The lock is a module-level flag in `server/server.ts`, so it does not survive a restart.
- The animation timings live in three places that nothing derives from each other: `ANIMATION_TIMELINE` in `client/animation-timeline.ts`, the `durationMs` values in `server/keyframes.ts`, and the runtime of `videos/background.mp4`. Keep them in step by hand.
- Do not edit `client/css/stars.css` by hand. `server/keyframes.ts` is the source. Run `just generate-css` after an edit. `just check` fails otherwise.

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
