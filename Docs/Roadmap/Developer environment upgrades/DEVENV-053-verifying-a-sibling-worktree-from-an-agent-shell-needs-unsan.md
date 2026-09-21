# DEVENV-053 — Verifying a sibling worktree from an agent shell needs unsandboxed commands

- **Status:** Candidate
- **Section:** External
- **Area:** Agent worktrees
- **Impact:** An agent whose session is rooted in one worktree but asked to land work in another cannot
  typecheck or run `./agent verify` there from the sandboxed shell; each attempt is re-run unsandboxed
  and goes through harness review.
- **Evidence:** 2026-09-05, session rooted in `.claude/worktrees/agent-response-preferences-2374d6`,
  work in `.claude/worktrees/main-landing-review-9f3a2c`: `bunx tsc --build packages/*/tsconfig.json`
  run through `sh -c 'cd <sibling> && …'` fails for all 19 projects with `TS5033: Could not write file
  '<sibling>/packages/ast-utils/tsconfig.tsbuildinfo': EPERM`, because the sandbox write allowlist
  covers only the session worktree. `bun --cwd <sibling> test <file>` reports `Script not found "test"`;
  `bun test --cwd <sibling> <file>` runs sandboxed because it writes nothing.
- **Workaround:** Run the typecheck and `./agent verify` for the sibling worktree unsandboxed; use
  `bun test --cwd <worktree> <files>` for focused tests.
- **Proposed change:** Give `./agent verify` a documented `--worktree <path>` form for verifying another
  checkout the agent owns, or allow sandbox writes under the repository's own `.claude/worktrees/*` so a
  branch an agent was asked to land can be verified in place.
- **Dependencies:** None.
- **Acceptance:** From a sandboxed agent shell rooted in one worktree, `bunx tsc --build` and
  `./agent verify` complete in a sibling worktree without an unsandboxed retry.
- **Source:** 2026-09-05 main-landing review.
