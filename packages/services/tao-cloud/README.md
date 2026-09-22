# tao-cloud

The package a Tao developer runs today for a local backend, and the home for the production server
it grows into.

## Now: the local InstantDB stack

`tao-cloud-src/local/` holds `just start-local-instantdb`'s adaptation of InstantDB's official
`self-hosting/docker-compose.local.yml` (Postgres, MinIO, the InstantDB server and dashboard) and
`seed-app.sql`, which idempotently provisions the stable app id WordFlower's InstantDB variant
mounts. The `LOCAL_INSTANTDB_*` `Justfile` variables and the `start-local-instantdb` /
`stop-local-instantdb` recipes point at this directory; run those recipes rather than the compose
file directly.

## Later: hosted defaults

This package is named for what it becomes, not only what it holds now: a production server offering
Tao's hosted defaults, such as an InstantDB data-adapter endpoint, so an app can mount a real backend
without a developer running InstantDB's stack themselves. The package boundary is drawn for that
future without building it yet — `packages/services/update-server` is the existing precedent for a
service package's shape (`<name>-src/`, `<name>-tests/`, a `bin` entry).
