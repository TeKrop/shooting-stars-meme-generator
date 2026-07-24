# Aliases

docker_compose := "docker compose"
docker_run := docker_compose + " run \
    --volume ${PWD}/package.json:/app/package.json \
    --volume ${PWD}/bun.lock:/app/bun.lock \
    --rm \
    bun"

# print recipe names and comments as help
help:
    @just --list

# build project images
build:
    @echo "Building Shooting Stars..."
    {{ docker_compose }} build

# run Shooting Stars application
start:
    @echo "Launching Shooting Stars (production mode)..."
    {{ docker_compose }} up -d

# run Shooting Stars in dev mode (live HMR via `bun --hot`)
dev:
    @echo "Launching Shooting Stars (dev mode, Bun HMR)..."
    {{ docker_compose }} --profile dev up bun-dev

# access an interactive shell inside the app container
shell:
    @echo "Running shell on bun container..."
    {{ docker_run }} /bin/sh

# type-check + lint/format-check the sources (bun runs .ts directly either way, this only checks)
check:
    @echo "Checking..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun run check

# auto-fix lint/format issues (biome)
format:
    @echo "Formatting..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun run lint:fix

# regenerate client/css/stars.css from server/keyframes.ts
generate-css:
    @echo "Generating stars.css..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun run generate:css

# run the test suite (bun:test)
test:
    @echo "Running tests..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun test

# run the test suite with a coverage report (text)
test-coverage:
    @echo "Running tests with coverage..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun test --coverage

# build & run Shooting Stars application (production mode)
up: build start

# stop the app and remove containers (preserves data volumes)
down:
    @echo "Stopping Shooting Stars and cleaning containers..."
    {{ docker_compose }} --profile "*" down --remove-orphans

# stop the app, remove containers and volumes (clean slate)
down_clean:
    @echo "Stopping Shooting Stars and cleaning containers and volumes..."
    {{ docker_compose }} --profile "*" down -v --remove-orphans

# update lock file
lock:
    @echo "Updating bun.lock..."
    {{ docker_run }} bun install

# clean up Docker environment
clean: down_clean
    @echo "Cleaning Docker environment..."
    docker image prune -af
    docker network prune -f
