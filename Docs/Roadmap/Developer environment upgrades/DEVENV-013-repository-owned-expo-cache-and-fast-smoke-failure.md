# DEVENV-013 — Repository-owned Expo cache and fast smoke failure

- **Status:** Incoming
- **Area:** Expo and Studio smoke
- **Impact:** Expo can fail writing its user cache in managed worktrees, and an early Studio exit used to
  degrade into an ambiguous readiness timeout.
- **Evidence:** Commits `5c365f35` and `b43eee9c` on
  `feat/freehand-ui-sketching-implementation` move Expo state into `.artifacts/cache/expo` and report
  bounded early-exit output.
- **Workaround:** Override Expo home to a repository-owned path and inspect the process log.
- **Proposed change:** Re-verify after merge; do not copy either implementation here.
- **Dependencies:** Freehand branch must land.
- **Acceptance:** Ordinary smoke launch uses the repository cache and reports an early child exit without
  waiting for readiness timeout.
- **Source:** 2026-09-03 freehand implementation summary.
