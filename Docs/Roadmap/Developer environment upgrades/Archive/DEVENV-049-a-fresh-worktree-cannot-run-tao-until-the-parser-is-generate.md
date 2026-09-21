# DEVENV-049 — A fresh worktree cannot run `./tao` until the parser is generated

- **Status:** Resolved
- **Area:** Worktree setup
- **Impact:** `./agent setup` is the documented one setup entry, yet the CLI it prepares fails on first
  use, so an agent's first `./tao` command in a new worktree dies with a module error unrelated to its
  task.
- **Evidence:** In a linked worktree created 2026-09-04, `./agent setup` completed with no install
  changes and `./tao fix Apps/Starters/Notebook` failed with `Cannot find module
  './_gen_tao-parser/module' from packages/parser/parser-src/parserASTExport.ts`; running
  `bun run packages/dev/dev-src/repository-tests/ParserGenerate.ts` (the `_parser-gen` recipe) fixed it.
  The stale variant is worse: on 2026-09-15 a linked worktree whose generated tree existed but predated
  the grammar ran `./tao test "Apps/Test Apps/Navigation/…"` to a bare `Something went wrong.`; only
  `TAO_DEBUG_ERRORS=1` revealed `undefined is not an object (evaluating 'AST.EntityCommandPolicy.$type')`
  at validator module load, and `just _parser-gen` fixed it.
  Reverified on 2026-09-20 in a fresh `feat/devenv-parser-cache-followups` linked worktree with no
  `node_modules` and no `_gen_tao-parser`: `./agent setup` printed `Langium generator finished
  successfully`, and the immediately subsequent `./tao check Apps/HNReader` reported `0
  noncanonical, 5 unchanged, 12 warnings` without a manual generation step.
- **Workaround:** Run `just _parser-gen`, or any lane that includes it, before the first `./tao` command.
- **Proposed change:** Implemented: `setup` orders `deps`, `_parser-gen`, `_agent-config`, and
  `_git-hooks`, so the documented setup entry materializes the parser before the first `./tao` use.
- **Dependencies:** None.
- **Acceptance:** In a fresh linked worktree, `./agent setup && ./tao check Apps/HNReader` succeeds
  without a manual generation step.
- **Source:** 2026-09-04 `tao create` work.
- **Archived:** 2026-09-20
