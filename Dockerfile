# ---- base: the package manifest and ffmpeg, shared by every stage below ----
# Debian, not oven/bun:1-alpine as before the export feature. Bun has a libc
# detection fault on Alpine that already broke lightningcss here, and would
# reach @napi-rs/canvas too. A different base image avoids it.
FROM oven/bun:1.4 AS base
WORKDIR /app
COPY package.json bun.lock /app/
# ffmpeg composites the rendered export frames over background.mp4 and
# encodes the result (see server/export.ts). The dev image needs it too:
# `just test` runs against bun-dev.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ---- deps: the full install with devDependencies, for dev only ----
# `just check` and `just test` run against bun-dev. That image therefore needs
# typescript and @biomejs/biome. The production image below does not.
FROM base AS deps
RUN bun install --frozen-lockfile

# ---- dev: live HMR through `bun --hot`. Compose bind-mounts the source. ----
FROM deps AS dev
CMD ["bun", "--hot", "server/server.ts"]

# ---- deps-prod: a runtime-only install. It keeps devDependencies out. ----
FROM base AS deps-prod
RUN bun install --frozen-lockfile --production

# ---- prod: the source is baked in. Bun bundles the assets at runtime. ----
# NODE_ENV=production is the one signal Bun.serve reads to switch its
# HTML-import bundler to minified, cached, hashed output. Load-bearing, not
# leftover branching.
FROM base
ENV NODE_ENV=production
COPY --from=deps-prod /app/node_modules /app/node_modules
COPY tsconfig.json /app/
COPY server /app/server/
COPY client /app/client/
CMD ["bun", "server/server.ts"]
