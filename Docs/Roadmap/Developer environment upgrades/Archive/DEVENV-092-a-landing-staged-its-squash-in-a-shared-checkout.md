# DEVENV-092 — A landing staged its squash in a shared checkout, where another agent committed it

- **Status:** Resolved
- **Area:** Landing and merge workflow
- **Impact:** `merge-with-main` ran `git merge --squash` in whichever worktree had `main` checked
  out — normally the primary checkout — and left that index full of the landing's work for as long
  as verification took, minutes at a time. Any other agent's `git commit` in that checkout captured
  it. That is not a hypothetical: it happened, and `main` took a commit whose subject was Git's
  `Squashed commit of the following:` appendix, authored by a landing that had not reached its
  commit step.
- **Evidence:** 2026-09-19, landing `feat/devenv-issues-skill-archive-7e2a57`. The command staged
  its squash at 18:01:41 and ran verification; at 18:02:50 `main` gained `f1b35755`, subject
  `Squashed commit of the following:`, carrying exactly the landing's tree, while the command was
  still verifying. It then refused to continue with `Repository state changed while validation was
  running`, which reports the damage but cannot undo it. Repairing it by hand had its own hazard:
  `git commit --amend` in that shared checkout swept in two files another agent had staged in the
  meantime, and the commit had to be rebuilt with `commit-tree` and the index restored with
  `reset --soft`.
- **Workaround:** None that survives concurrency. Landing one branch at a time only shrinks the
  window.
- **Proposed change:** Build the landing commit with plumbing and move the ref atomically, so no
  checkout is involved: `git commit-tree` from the verified feature tree, then `git update-ref` with
  the expected old value. Refuse to land while any worktree has `main` checked out, because a
  checked-out branch promises that a worktree's files match it. Let mirrors be detached checkouts
  the landing moves forward itself.
- **Dependencies:** None. Implemented by `feat/land-without-a-shared-checkout`.
- **Acceptance:** A landing never writes to a checkout other than the invoking feature worktree, a
  landing that fails leaves no commit and no staged state anywhere, and two landings racing on one
  machine cannot interleave: the second is refused by the ref's compare-and-swap.
- **Source:** 2026-09-19 landing incident.
- **Archived:** 2026-09-19
