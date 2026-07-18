# ---- deps: full install (incl. devDependencies), shared by dev + build stages ----
FROM node:24-alpine AS deps
WORKDIR /code
COPY package.json package-lock.json /code/
RUN npm ci

# ---- dev: live HMR via Vite middleware, source is bind-mounted at runtime ----
FROM deps AS dev
ENV NODE_ENV=dev
CMD ["node", "server.js"]

# ---- build: compile LESS/JS into a static, minified bundle ----
FROM deps AS build
COPY index.html vite.config.js /code/
COPY src /code/src/
COPY public /code/public/
RUN npm run build

# ---- prod: slim runtime image, only the built dist/ + prod deps ----
FROM node:24-alpine
WORKDIR /code
COPY package.json package-lock.json server.js /code/
RUN npm ci --omit=dev
COPY --from=build /code/dist /code/dist/
CMD ["node", "server.js"]
