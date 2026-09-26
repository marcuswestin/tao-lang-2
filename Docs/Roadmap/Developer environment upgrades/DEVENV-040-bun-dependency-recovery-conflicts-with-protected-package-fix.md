# DEVENV-040 — Bun dependency recovery conflicts with protected package fixtures

- **Status:** Candidate
- **Section:** External
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
- **Additional evidence (2026-09-19):** Adding the host-testing Playwright dependency in worktree
  `40f2` made `./agent help` stop at `EEXIST: failed to link package: keytar@7.9.0 (clonefileat)`.
  The new dependency was present, so the declared `just test-host` recipe could validate the
  prototype, but the front-door bootstrap remained blocked. No dependency-tree removal or
  permission workaround was attempted.
- **Continuation (2026-09-19):** In the same `40f2` worktree, reviewed execution outside the task
  sandbox now runs `./agent help`, `test-host`, and focused `test-file` commands successfully.
  No dependency-tree removal was needed. This clears that session's blocker without establishing
  that the protected-package recovery defect itself is fixed.
- **Additional evidence (2026-09-26):** Registering the local account-server workspace in `68b8`
  made `./agent setup --refresh-lockfile` fail on `keytar@7.9.0 (clonefile)`. The approved
  unsandboxed command retry returned the same failure. The new server's focused test was blocked
  in dependency bootstrap before running. Source edits were preserved and implementation stopped;
  no dependency-tree removal, move, or alternate install backend was attempted. The current
  workflow directs a fresh unsandboxed session followed by `./agent setup`.
  After the Developer's recovery, dependencies linked successfully. The later setup failure came
  from disposable permission-render staging, repaired under
  DEVENV-GATE-SCRATCH-CLEANUP-DENIED-IN-MANAGED-WORKTREE. Setup completed at 09:39 UTC and local
  account-server tests ran; this task no longer has a dependency-install blocker.
- **Workaround:** First move the stale `node_modules` directory intact to a unique path under
  `/private/tmp`, without reading or deleting its contents, then run `bun install --frozen-lockfile`.
  If both recursive removal and that atomic move are denied, continue the branch in a fresh linked
  worktree and run `./agent setup` there.
- **Proposed change:** Make the dependency workflow repair stale links idempotently, and teach its
  recovery diagnostic to recommend an atomic move followed by a fresh linked worktree when protected
  third-party fixture names prevent recovery in place.
- **Dependencies:** None.
- **Acceptance:** A fixture reproducing the protected-path link failure recovers through the documented
  command without reading protected content, and a second `./agent verify` dependency check is clean.
- **Source:** 2026-09-04 freehand/main merge verification.
