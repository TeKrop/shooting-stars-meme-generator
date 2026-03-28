# Aliases

docker_compose := "docker compose"
docker_run := docker_compose + " run \
    --volume ${PWD}/package.json:/code/package.json \
    --volume ${PWD}/package-lock.json:/code/package-lock.json \
    --rm \
    node"

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

# access an interactive shell inside the app container
shell:
    @echo "Running shell on node container..."
    {{ docker_run }} /bin/sh

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
    @echo "Updating package-lock.json..."
    {{ docker_run }} npm install

# clean up Docker environment
clean: down_clean
    @echo "Cleaning Docker environment..."
    docker image prune -af
    docker network prune -f
