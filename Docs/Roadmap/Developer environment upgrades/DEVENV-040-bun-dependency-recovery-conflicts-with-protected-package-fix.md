# DEVENV-040 — Bun dependency recovery conflicts with protected package fixtures

- **Status:** Candidate
- **Area:** Dependency installation
- **Impact:** A stale Bun link can block every verification command, while the documented clean-install
  recovery cannot remove a dependency tree containing a sandbox-protected fixture file.
- **Evidence:** After merging main, `./agent verify` failed with `EEXIST: failed to link package:
  expo-updates@29.0.20`; the prescribed `rm -rf node_modules` then stopped at Expo's
  `e2e/fixtures/project_files/.env` with `Operation not permitted` even in the approved elevated command.
- **Workaround:** Move the stale `node_modules` directory intact to a unique path under `/private/tmp`,
  without reading or deleting its contents, then run `bun install --frozen-lockfile`.
- **Proposed change:** Make the dependency workflow repair stale links idempotently, and teach its recovery
  diagnostic to recommend an atomic move when protected third-party fixture names prevent recursive removal.
- **Dependencies:** None.
- **Acceptance:** A fixture reproducing the protected-path link failure recovers through the documented
  command without reading protected content, and a second `./agent verify` dependency check is clean.
- **Source:** 2026-09-04 freehand/main merge verification.
