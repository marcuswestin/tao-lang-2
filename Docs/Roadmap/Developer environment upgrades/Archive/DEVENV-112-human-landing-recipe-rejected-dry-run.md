# DEVENV-112 — The human landing recipe rejected the landing dry-run flag

- **Status:** Resolved
- **Area:** Landing workflow
- **Impact:** The landing guide documents `just merge-with-main` and its read-only `--dry-run`, but the
  human recipe rejected that flag before the underlying landing command could report its plan.
- **Evidence:** In a fresh worktree on 2026-09-20, `just merge-with-main --dry-run` exited with
  `Recipe 'merge-with-main' does not have option '--dry-run'`. After the fix,
  `just --dry-run merge-with-main --dry-run` expands to `./dev merge-with-main --dry-run`, and the real
  command reaches the repository preflight. The focused worktree-profile suite covers the forwarding.
- **Workaround:** Before the fix, invoke `./dev merge-with-main --dry-run` directly.
- **Proposed change:** Implemented: declare the flag on the Just recipe and forward it unchanged to the
  repository landing command.
- **Dependencies:** None.
- **Acceptance:** `just merge-with-main --dry-run` reaches the underlying read-only landing preflight,
  and focused coverage prevents the human recipe from dropping the flag again.
- **Source:** 2026-09-20 follow-up landing dry run.
- **Archived:** 2026-09-20
