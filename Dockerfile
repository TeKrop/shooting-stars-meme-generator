# ---- deps: install dependencies, shared by dev + prod ----
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock /app/
RUN bun install --frozen-lockfile

# ---- dev: live HMR via `bun --hot`, source is bind-mounted at runtime ----
FROM deps AS dev
ENV NODE_ENV=development
CMD ["bun", "--hot", "server.js"]

# ---- prod: source baked in, Bun bundles/minifies/caches assets lazily at runtime ----
FROM deps
ENV NODE_ENV=production
COPY server.js index.html /app/
COPY src /app/src/
COPY public /app/public/
CMD ["bun", "server.js"]
