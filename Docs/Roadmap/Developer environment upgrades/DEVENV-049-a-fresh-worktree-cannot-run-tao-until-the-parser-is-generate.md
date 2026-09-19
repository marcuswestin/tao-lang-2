# DEVENV-049 — A fresh worktree cannot run `./tao` until the parser is generated

- **Status:** Candidate
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
- **Workaround:** Run `just _parser-gen`, or any lane that includes it, before the first `./tao` command.
- **Proposed change:** Have `setup` run `_parser-gen` when `packages/parser/parser-src/_gen_tao-parser`
  is missing or older than the grammar, or have `./tao` generate on demand with a one-line notice.
- **Dependencies:** None.
- **Acceptance:** In a fresh linked worktree, `./agent setup && ./tao check Apps/HNReader` succeeds
  without a manual generation step.
- **Source:** 2026-09-04 `tao create` work.
