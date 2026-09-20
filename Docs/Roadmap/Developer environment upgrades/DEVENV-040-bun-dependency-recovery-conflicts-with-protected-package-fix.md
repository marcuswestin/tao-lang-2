# DEVENV-040 — Bun dependency recovery conflicts with protected package fixtures

- **Status:** Candidate
- **Area:** Dependency installation
- **Impact:** A stale Bun link can block every verification command, while the documented clean-install
  recovery cannot remove a dependency tree containing a sandbox-protected fixture file.
- **Evidence:** After merging main, `./agent verify` failed with `EEXIST: failed to link package:
  expo-updates@29.0.20`; the prescribed `rm -rf node_modules` then stopped at Expo's
  `e2e/fixtures/project_files/.env` with `Operation not permitted` even in the approved elevated command.
  Reproduced on 2026-09-20 in the original `feat/devenv-parser-cache-followups` checkout: `./agent
  setup` failed to link `keytar@7.9.0` even though `./agent doctor` reported the dependencies complete.
  The prescribed removal stopped partway on protected package contents, and moving the remaining
  `node_modules` directory intact to `/private/tmp` was also denied with `Operation not permitted`.
- **Workaround:** Continue the branch in a fresh linked worktree and run `./agent setup` there; both
  recursive removal and an atomic move can be denied once the stale tree contains protected paths.
- **Proposed change:** Make the dependency workflow repair stale links idempotently, and teach its
  recovery diagnostic to offer a fresh linked worktree when protected third-party fixture names
  prevent both recursive removal and an atomic move.
- **Dependencies:** None.
- **Acceptance:** A fixture reproducing the protected-path link failure recovers through the documented
  command without reading protected content, and a second `./agent verify` dependency check is clean.
- **Source:** 2026-09-04 freehand/main merge verification.
