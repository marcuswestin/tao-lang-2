# DEVENV-040 — Bun dependency recovery conflicts with protected package fixtures

- **Status:** Resolved
- **Area:** Dependency installation
- **Impact:** A stale Bun link can block every verification command, while the documented clean-install
  recovery cannot remove a dependency tree containing a sandbox-protected fixture file.
- **Evidence:** After merging main, `./agent verify` failed with `EEXIST: failed to link package:
  expo-updates@29.0.20`; the prescribed `rm -rf node_modules` then stopped at Expo's
  `e2e/fixtures/project_files/.env` with `Operation not permitted` even in the approved elevated command.
- **Workaround:** Move the stale `node_modules` directory intact to a unique path under `/private/tmp`,
  without reading or deleting its contents, then run `bun install --frozen-lockfile`.
- **Proposed change:** Implemented by `just repair-deps` and the automatic `just deps` fallback. The
  dependency-free helper takes a checkout-local lock, moves `node_modules` as one entry into a unique
  `/private/tmp/tao-dependency-repair.*` backup, runs one frozen clean install, and restores the original
  tree if installation or health verification fails or is interrupted.
- **Dependencies:** None.
- **Acceptance:** Met on 2026-09-19. Eight focused recovery tests cover success, failure, interruption,
  lock contention, move failure, protected fixture names, automatic fallback, and the healthy no-op;
  the integrated dependency and setup tests also pass.
- **Source:** 2026-09-04 freehand/main merge verification.
