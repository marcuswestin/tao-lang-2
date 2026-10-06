# DEVENV-TEST-FILE-STOPS-ON-MISSING-BINDING-MANIFEST-IN-FRESH-WORKTREE — `test-file` stops on a missing binding manifest in a fresh worktree

- **Status:** Candidate
- **Section:** External
- **Area:** `./agent test-file`, maintained native binding generation, fresh worktrees
- **Impact:** In a worktree that has never generated maintained native bindings, a focused test
  run that compiles an app refuses with a missing-manifest error instead of generating the
  bindings, so the first test run in every new worktree fails once and costs a turn to diagnose.
- **Evidence:** 2026-10-06, a fresh worktree created for the CI completion review:
  `./agent test-file packages/cli/tao-cli/cli-tests/creation-firebase.test.ts` stopped with
  `Maintained native binding manifest is missing`. `./agent native-bindings` once, then the same
  command, passed. `open-pr` already regenerates stale bindings before the complement for the same
  reason (DEVENV-STALE-MAINTAINED-BINDINGS-AFTER-MERGE, archived); the focused test path does not.
- **Workaround:** Run `./agent native-bindings` once in a fresh worktree before `./agent test-file`.
- **Proposed change:** `test-file`, and any focused lane that compiles an app, generates the
  maintained bindings when the manifest is missing or stale, the way the complement does, and keeps
  the refusal for the case where generation itself fails.
- **Dependencies:** None.
- **Acceptance:** In a fresh worktree, `./agent test-file` on a test that compiles an app passes on
  the first run without a separate bindings command.
- **Source:** CI completion review fix round, 2026-10-06.
