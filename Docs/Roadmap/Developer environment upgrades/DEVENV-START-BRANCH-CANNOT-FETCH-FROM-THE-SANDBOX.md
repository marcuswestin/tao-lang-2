# DEVENV-START-BRANCH-CANNOT-FETCH-FROM-THE-SANDBOX — start-branch cannot fetch from the sandbox, and the manual fallback half-applies

- **Status:** Candidate
- **Section:** External
- **Area:** Worktrees and branching
- **Impact:** `./agent start-branch feat/<name>` is the documented way to start a branch, and a
  sandboxed agent cannot run it: its `git fetch` reaches the GitHub CLI credential helper, whose
  configuration directory is a non-escalatable read deny. The obvious fallback,
  `git switch -c feat/<name> origin/main`, is worse than a refusal. It creates the branch and checks
  out its files, then fails writing upstream tracking into the primary checkout's `.git/config`,
  which a worktree's sandbox may not lock. HEAD stays on the old branch with the new tree staged
  against it, so a careless commit would record main's tree as a change on the old branch.
- **Evidence:** 2026-09-27, worktree `figma-canvas-draw-mode-bb077e`. `start-branch` stopped at
  `git fetch`; `git switch -c feat/layer-view origin/main` then reported that
  `/Users/ro/code/tao-lang-2/.git/config` could not be locked. The same credential boundary is
  archived as DEVENV-088 for `merge-with-main`, whose fix did not reach `start-branch`.
- **Workaround:** Branch from the already-fetched `origin/main` without tracking:
  `git switch --no-track -c feat/<name> origin/main`. To recover a half-applied switch, point HEAD
  at the branch it created, `git symbolic-ref HEAD refs/heads/feat/<name>`, which leaves a clean
  status because index and tree already match it.
- **Proposed change:** Give `start-branch` an `unsandboxed` host operation, as `merge-main` has, or
  let it branch from the current `origin/main` with `--no-track` when the fetch is refused, saying
  how old that ref is.
