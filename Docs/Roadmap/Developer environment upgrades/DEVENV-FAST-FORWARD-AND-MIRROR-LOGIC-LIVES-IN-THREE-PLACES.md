# DEVENV-FAST-FORWARD-AND-MIRROR-LOGIC-LIVES-IN-THREE-PLACES — Fast-forward and mirror logic lives in three places

- **Status:** Candidate
- **Section:** External
- **Area:** `SyncLocalMain.ts` (`sync-main`), `MergeWithMain.ts` (local `land`), `DeveloperWorkflow`
  (`just my-sync`)
- **Impact:** Moving local `main` forward and refreshing the detached mirror worktrees at its old
  tip is implemented three times. The three already differ in detail (which worktrees count as
  mirrors, how a dirty checkout is reported), so a fix or a scope decision in one does not reach
  the others.
- **Evidence:** `sync-main` landed on 2026-10-06 (PR 52) with its own fast-forward and mirror loop
  (`SyncLocalMain.ts:81–94`), modelled on `MergeWithMain.ts:147`, beside the older `my-sync`. On its
  first run after a landing it moved five clean detached worktrees under another harness's
  worktree directory from the old `main` tip to the new one, which the mirror rule allows (any
  clean detached checkout at the old tip) but nobody had decided. The review of the project
  (2026-10-06) also noted that `sync-main` reports every `merge-base` error as "diverged".
- **Workaround:** None needed; the behaviour is consistent today because the copies still agree.
- **Proposed change:** One helper in `packages/testing/verification` that fast-forwards `main` and
  moves mirrors, called from all three, taking the mirror scope as an argument. The scope is the
  Developer's decision: repository-owned worktrees only (under the primary checkout's `.worktrees`
  directory), or every clean detached checkout at the old tip as today.
- **Dependencies:** The Developer's decision on mirror scope.
- **Acceptance:** One implementation, three callers, with a unit test for the scope rule; a
  checkout outside the chosen scope is left where it is and named in the output.
- **Source:** Slice B of the CI completion project and its review, 2026-10-06.
