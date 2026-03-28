# print recipe names and comments as help
help:
    @just --list

# build project images
build:
    @echo "Building Shooting Stars..."
    docker compose build

# run Shooting Stars application
start:
    @echo "Launching Shooting Stars (production mode)..."
    docker compose up -d

# build & run Shooting Stars application (production mode)
up: build start

# stop the app and remove containers (preserves data volumes)
down:
    @echo "Stopping Shooting Stars and cleaning containers..."
    docker compose --profile "*" down --remove-orphans

# stop the app, remove containers and volumes (clean slate)
down_clean:
    @echo "Stopping Shooting Stars and cleaning containers and volumes..."
    docker compose --profile "*" down -v --remove-orphans

# clean up Docker environment
clean: down_clean
    @echo "Cleaning Docker environment..."
    docker image prune -af
    docker network prune -f
