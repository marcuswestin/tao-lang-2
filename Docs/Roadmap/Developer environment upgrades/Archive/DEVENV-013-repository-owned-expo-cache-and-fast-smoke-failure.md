# DEVENV-013 — Repository-owned Expo cache and fast smoke failure

- **Status:** Resolved
- **Area:** Expo and Studio smoke
- **Impact:** Expo can fail writing its user cache in managed worktrees, and an early Studio exit used to
  degrade into an ambiguous readiness timeout.
- **Evidence:** Commits `5c365f35` and `b43eee9c` on
  `feat/freehand-ui-sketching-implementation` move Expo state into `.artifacts/cache/expo` and report
  bounded early-exit output.
- **Workaround:** Override Expo home to a repository-owned path and inspect the process log.
- **Proposed change:** Re-verify after merge; do not copy either implementation here.
- **Dependencies:** Resolved on current `main`.
- **Acceptance:** Ordinary smoke launch uses the repository cache and reports an early child exit without
  waiting for readiness timeout.
- **Resolution (2026-09-20):** Reverified at `7b7dc0bc`: the Expo development-loop suite passed 42/42
  and Studio smoke-launch passed 6/6. The focused assertions cover the repository-owned Expo home and
  immediate early-exit diagnostic.
- **Source:** 2026-09-03 freehand implementation summary.
- **Archived:** 2026-09-20
