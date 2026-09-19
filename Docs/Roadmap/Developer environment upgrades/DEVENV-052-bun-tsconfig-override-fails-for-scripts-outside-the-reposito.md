# DEVENV-052 — `bun --tsconfig-override` fails for scripts outside the repository

- **Status:** Candidate
- **Area:** Agent scratch tooling
- **Impact:** An agent cannot run a throwaway script from its scratchpad against the repository's path
  aliases, so probes end up as files inside the worktree.
- **Evidence:** `bun --tsconfig-override packages/tsconfig.base.json run <script outside the repo>` fails
  in bun 1.3.13 with `Internal error: directory mismatch for directory ".../packages/tsconfig.base.json"`.
- **Workaround:** Put scratch scripts under the ignored `.artifacts/tmp/` and import repository sources by
  absolute path; remove them afterwards.
- **Proposed change:** Document the `.artifacts/tmp/` convention for agent probes, or add a `./agent
  probe <script>` entry that runs a script with the repository's aliases.
- **Dependencies:** None.
- **Acceptance:** A documented one-line way to run a scratch TypeScript file against `@shared` and
  friends from outside the source tree.
- **Source:** 2026-09-04 `tao create` review.
