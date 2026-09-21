# DEVENV-048 — A fresh linked worktree cannot launch Studio until the parser is generated

- **Status:** Candidate
- **Section:** External
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
- **Dependencies:** DEVENV-063 now makes the managed-host boundary fail fast, but a real Studio host
  run from an ordinary shell is still required before this entry can resolve.
- **Acceptance:** Parser generation and the subsequent CLI check passed from the fresh integration
  worktree on 2026-09-19. The headless Studio launch then reached Metro but failed because Watchman
  could not write its LaunchAgent and Metro exhausted macOS file watchers, so the Studio half remains
  open under DEVENV-063 rather than being reported as green. Reverified on 2026-09-20 from the fresh
  `feat/devenv-landing-followups` checkout: `./agent setup` generated the parser, `./tao check
  Apps/HNReader` completed with zero noncanonical files, and the first real-app Studio case passed.
  The subsequent Metro-backed case again failed with Watchman denied and Node watcher `EMFILE`, so
  the required complete Studio host proof remained unproved. On the 2026-09-20 follow-up branch,
  fresh `./agent setup` and `./tao check Apps/HNReader` passed again; the Studio smoke now stopped
  before Metro with DEVENV-063's actionable Watchman LaunchAgent diagnostic instead of `EMFILE`.
  Reproduced again on 2026-09-20 in a fresh `feat/devenv-parser-cache-followups` linked worktree:
  `./agent setup` generated the parser and `./tao check Apps/HNReader` reported `0 noncanonical, 5
  unchanged, 12 warnings`. `./agent studio-smoke` then reached `Starting Metro Bundler` before failing
  with `Your macOS system limit does not allow enough watchers for Metro` and `EMFILE: too many open
  files, watch`. That is host-boundary evidence, not a parser regression, so the Studio acceptance
  remains open.
  Resolve this entry only after the same smoke reaches readiness in a supported host shell.
- **Source:** 2026-09-04 Studio visual design work.
