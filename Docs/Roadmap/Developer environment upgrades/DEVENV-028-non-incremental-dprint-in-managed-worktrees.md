# DEVENV-028 — Non-incremental dprint in managed worktrees

- **Status:** Resolved
- **Area:** Formatting
- **Impact:** dprint's incremental user cache may be unwritable under a managed policy.
- **Evidence:** Every current Justfile dprint invocation passes `--incremental=false` and verification is
  green under that mode.
- **Workaround:** None required for repository commands.
- **Proposed change:** Reopen only if a new command omits the flag; prefer repository-owned cache state if
  incremental formatting is deliberately restored.
- **Dependencies:** Preserve freehand formatting exclusions when that branch lands.
- **Acceptance:** Repository formatting commands do not write the user dprint cache.
- **Source:** 2026-09-03 repository inspection and freehand notes.
