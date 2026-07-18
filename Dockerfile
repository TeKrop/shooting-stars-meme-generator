# ---- deps: install dependencies, shared by dev + prod ----
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock /app/
RUN bun install --frozen-lockfile

# ---- dev: live HMR via `bun --hot`, source is bind-mounted at runtime ----
FROM deps AS dev
CMD ["bun", "--hot", "server.js"]

# ---- prod: source baked in, Bun bundles/minifies/caches assets lazily at runtime ----
# NODE_ENV=production is the one signal Bun.serve checks to switch its HTML-import
# bundler from dev mode (unminified, /_bun/ paths) to production mode (minified,
# cached, hashed filenames) — genuinely load-bearing, not leftover branching.
FROM deps
ENV NODE_ENV=production
COPY server.js index.html /app/
COPY src /app/src/
COPY public /app/public/
CMD ["bun", "server.js"]
