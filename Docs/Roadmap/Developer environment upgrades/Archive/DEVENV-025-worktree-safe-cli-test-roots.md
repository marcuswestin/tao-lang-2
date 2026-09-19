# DEVENV-025 — Worktree-safe CLI test roots

- **Status:** Resolved
- **Area:** CLI tests
- **Impact:** Generated runtime roots beneath package directories could fail in restrictive worktrees.
- **Evidence:** Main commit `1ac7edd8` routes the affected `tao test` CLI cases through temporary runtime
  roots.
- **Workaround:** None required.
- **Proposed change:** Preserve the shared temporary-root helper in later test changes.
- **Dependencies:** None.
- **Acceptance:** The affected CLI tests pass from linked managed worktrees.
- **Source:** 2026-09-03 main history and freehand review notes.
- **Archived:** 2026-09-19
