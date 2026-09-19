# DEVENV-009 — Safe, repeatable feature landing

- **Status:** Resolved
- **Area:** Git workflow
- **Impact:** Manually squashing before validation can strand `main` dirty, omit the full host proof, or
  lose the repository's squash-message convention.
- **Evidence:** `git merge --abort` cannot undo `git merge --squash`; landing spans two worktrees and
  several ref-changing phases.
- **Workaround:** Follow the Git skill manually and inspect every intermediate tree.
- **Proposed change:** Add a human-only, dry-run-first `merge-with-main` command with snapshots, strict
  phase ordering, tree equality, guarded abort, and explicit push authority.
- **Dependencies:** Implemented by `feat/verification-lanes`; no Git hook.
- **Acceptance:** Unit tests cover read-only preflight, complete-message validation, atomic snapshots,
  concurrent-state refusal, the pre-push recovery boundary, and abort guards; a disposable bare
  remote plus two real Git worktrees proves squash, tree equality, push, archive, local-branch
  cleanup, and preservation of a clean detached invoking worktree until its task is archived.
- **Source:** 2026-09-03 verification-lanes brief.
