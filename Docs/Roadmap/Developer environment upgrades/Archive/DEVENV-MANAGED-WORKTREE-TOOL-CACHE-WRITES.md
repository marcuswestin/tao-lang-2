# DEVENV-MANAGED-WORKTREE-TOOL-CACHE-WRITES — Managed worktree tool cache writes

- **Status:** Resolved
- **Section:** External
- **Area:** Formatting and verification
- **Impact:** Ordinary formatting and the unchanged watchOS compiler suite fail in writable
  worktrees because tool caches default to protected user directories.
- **Evidence:** On the Syntax2 foundation revision `3bcd71647`, independent worktrees reproduced
  Swift's `error opening '/Users/ro/.cache/clang/ModuleCache/Swift-7JL1KBZ3A6V3.swiftmodule' for
  output` followed by `Operation not permitted`. The unchanged suite passes all 15 tests when
  only `CLANG_MODULE_CACHE_PATH` points into the worktree. Formatting also attempts to write
  `plugin-cache-manifest.json` in the user dprint cache despite `--incremental=false`; a local
  `DPRINT_CACHE_DIR` succeeds. The earlier archived DEVENV-028 concerns incremental cache writes,
  whereas these failures concern plugin/module caches with the existing non-incremental commands.
- **Workaround:** Supply worktree-local `CLANG_MODULE_CACHE_PATH` and `DPRINT_CACHE_DIR`.
- **Proposed change:** Default both caches in the Justfile to `.artifacts/cache/` directories,
  preserving explicit caller overrides. Keep recipe children and named host workflows on the same
  defaults; do not widen host-operation permissions or change test expectations.
- **Dependencies:** None.
- **Acceptance:** Ordinary `./agent fmt` and the unchanged watchOS suite pass without cache
  overrides, create their cache files inside the calling worktree, and preserve explicit overrides.
- **Source:** 2026-10-04 Syntax2 integration; task-local baseline/mutation evidence in the numeric
  and nominal worktrees, with coordinator evidence retained under `.artifacts/logs/`.
- **Resolution:** Justfile defaults now preserve caller overrides and route both caches into the
  calling worktree. Ordinary formatting passes without overrides; the unchanged watchOS suite
  passes all 15 tests without overrides. The existing host-operation permissions are unchanged.
- **Archived:** 2026-10-04
