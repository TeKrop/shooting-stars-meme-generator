# Aliases

docker_compose := "docker compose"
docker_run := docker_compose + " run \
    --volume ${PWD}/package.json:/app/package.json \
    --volume ${PWD}/bun.lock:/app/bun.lock \
    --rm \
    bun"

# Prints the recipe names and their comments as help.
help:
    @just --list

# Builds the project images.
build:
    @echo "Building Shooting Stars..."
    {{ docker_compose }} build

# Runs the Shooting Stars application.
start:
    @echo "Launching Shooting Stars (production mode)..."
    {{ docker_compose }} up -d

# Runs Shooting Stars in dev mode. `bun --hot` gives live HMR.
dev:
    @echo "Launching Shooting Stars (dev mode, Bun HMR)..."
    {{ docker_compose }} --profile dev up bun-dev

# Opens an interactive shell in the app container.
shell:
    @echo "Running shell on bun container..."
    {{ docker_run }} /bin/sh

# Checks the types, the lint rules, and the format. This recipe only reports.
check:
    @echo "Checking..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun run check

# Corrects the lint problems and the format problems, with Biome.
format:
    @echo "Formatting..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun run lint:fix

# Regenerates client/css/stars.css from server/keyframes.ts.
generate-css:
    @echo "Generating stars.css..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun run generate:css

# Runs the test suite, with bun:test.
test:
    @echo "Running tests..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun test

# Runs the test suite with a coverage report, as text.
test-coverage:
    @echo "Running tests with coverage..."
    {{ docker_compose }} --profile dev run --rm bun-dev bun test --coverage

# Builds and runs the Shooting Stars application, in production mode.
up: build start

# Stops the app and removes the containers. Keeps the data volumes.
down:
    @echo "Stopping Shooting Stars and cleaning containers..."
    {{ docker_compose }} --profile "*" down --remove-orphans

# Stops the app. Removes the containers and the volumes.
down_clean:
    @echo "Stopping Shooting Stars and cleaning containers and volumes..."
    {{ docker_compose }} --profile "*" down -v --remove-orphans

# Updates the lock file.
lock:
    @echo "Updating bun.lock..."
    {{ docker_run }} bun install

# Cleans up the Docker environment.
clean: down_clean
    @echo "Cleaning Docker environment..."
    docker image prune -af
    docker network prune -f
