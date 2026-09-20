# DEVENV-048 — A fresh linked worktree cannot launch Studio until the parser is generated

- **Status:** In progress
- **Area:** Worktree setup
- **Impact:** The one setup entry leaves a new worktree unable to run the product; the first Studio launch
  fails with a module error that reads like a broken checkout rather than a missing step.
- **Evidence:** In a new `.claude/worktrees/` checkout, `./agent setup` ran only `bun install`; `./dev studio
  Apps/HNReader` then exited with `Cannot find module './_gen_tao-parser/module'` until
  `bun run packages/dev/dev-src/repository-tests/ParserGenerate.ts` (the `_parser-gen` gate) had run.
  `direnv allow` was also needed first, and it must run from an unsandboxed shell because the allow file
  lives under `~/.local/share/direnv`.
- **Workaround:** Run `just _parser-gen` after `./agent setup` in a new worktree.
- **Proposed change:** Implemented: the one setup recipe now orders `deps`, `_parser-gen`, and
  `_agent-config`, and every harness setup comment states the same bootability contract.
- **Dependencies:** DEVENV-063 blocks the remaining Studio host proof in the managed task namespace.
- **Acceptance:** Parser generation and the subsequent CLI check passed from the fresh integration
  worktree on 2026-09-19. The headless Studio launch then reached Metro but failed because Watchman
  could not write its LaunchAgent and Metro exhausted macOS file watchers, so the Studio half remains
  open under DEVENV-063 rather than being reported as green.
- **Source:** 2026-09-04 Studio visual design work.
