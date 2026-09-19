# DEVENV-048 — A fresh linked worktree cannot launch Studio until the parser is generated

- **Status:** Candidate
- **Area:** Worktree setup
- **Impact:** The one setup entry leaves a new worktree unable to run the product; the first Studio launch
  fails with a module error that reads like a broken checkout rather than a missing step.
- **Evidence:** In a new `.claude/worktrees/` checkout, `./agent setup` ran only `bun install`; `./dev studio
  Apps/HNReader` then exited with `Cannot find module './_gen_tao-parser/module'` until
  `bun run packages/dev/dev-src/repository-tests/ParserGenerate.ts` (the `_parser-gen` gate) had run.
  `direnv allow` was also needed first, and it must run from an unsandboxed shell because the allow file
  lives under `~/.local/share/direnv`.
- **Workaround:** Run `just _parser-gen` after `./agent setup` in a new worktree.
- **Proposed change:** Make `setup` depend on `_parser-gen`, or have `./dev studio` generate the parser
  when the generated tree is missing.
- **Dependencies:** None.
- **Acceptance:** A new linked worktree reaches a ready Studio session after `./agent setup` and
  `./dev studio Apps/HNReader` alone.
- **Source:** 2026-09-04 Studio visual design work.
