# ---- base: package manifest + ffmpeg, shared by every stage below ----
# Debian-based, not oven/bun:1-alpine like before the export feature (see
# server/export.ts): @napi-rs/canvas ships prebuilt musl (Alpine) binaries in
# principle, but Bun has its own libc-detection bug on Alpine images that has
# already bitten a different native dependency in this repo (lightningcss) —
# switching base image sidesteps it rather than debugging musl detection.
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock /app/
# ffmpeg composites the export's rendered frames over background.mp4 and
# encodes the result (see server/export.ts) — needed in dev too, since
# bun-dev is what `just test` and manual export testing run against.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ---- deps: full install (incl. devDependencies), used by dev only ----
# `just check`/`just test` run typecheck/lint against bun-dev, so that image
# needs typescript/@biomejs/biome — the prod image below does not.
FROM base AS deps
RUN bun install --frozen-lockfile

# ---- dev: live HMR via `bun --hot`, source is bind-mounted at runtime ----
FROM deps AS dev
CMD ["bun", "--hot", "server/server.ts"]

# ---- deps-prod: runtime-only install, keeps devDependencies out of prod image ----
FROM base AS deps-prod
RUN bun install --frozen-lockfile --production

# ---- prod: source baked in, Bun bundles/minifies/caches assets lazily at runtime ----
# NODE_ENV=production is the one signal Bun.serve checks to switch its HTML-import
# bundler from dev mode (unminified, /_bun/ paths) to production mode (minified,
# cached, hashed filenames) — genuinely load-bearing, not leftover branching.
FROM base
ENV NODE_ENV=production
COPY --from=deps-prod /app/node_modules /app/node_modules
COPY tsconfig.json /app/
COPY server /app/server/
COPY client /app/client/
CMD ["bun", "server/server.ts"]
