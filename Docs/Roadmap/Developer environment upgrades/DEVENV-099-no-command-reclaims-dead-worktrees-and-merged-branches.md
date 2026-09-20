# DEVENV-099 — No command reclaims dead worktrees and merged branches

- **Status:** Candidate
- **Area:** Worktrees, landing, diagnostics
- **Impact:** Checkouts and branches accumulate without bound because nothing reclaims them.
  `merge-with-main` deliberately leaves a landed branch's worktree in place, clean and detached at
  the archived feature tip, "for the owning task to archive" — but the owning task has usually ended
  by then, so nobody archives it. `git worktree prune` does not help: it removes only records whose
  directory is already gone, and every accumulated worktree still has its directory. The result is a
  sweep that has to be assembled by hand, and a hand-assembled sweep is the one that deletes another
  agent's in-flight work.
- **Evidence:** On 2026-09-19 this repository held 44 registered worktrees across five homes and 66
  local branches; `git worktree prune -v --dry-run` printed nothing, so none of the 44 was prunable.
  Fifteen of the branches were fully contained in `main`, and eight worktrees were clean, idle for
  17 hours to 19 days, and detached at or on a branch contained in `main` or an `origin/merged/*`
  ref. Establishing that safely took a hand-built inventory joining four sources — the lane registry
  at `~/.cache/tao/machine-lanes/*.lane.json`, a single `ps -axo pid=,ppid=,lstart=,command=`
  capture, per-worktree file mtimes, and `git merge-base --is-ancestor` against both `main` and 42
  `origin/merged/*` refs. The liveness check was not academic: between producing the inventory and
  acting on it, `simplify-repo-dedup-908830` — clean, detached at `origin/merged/lane-admission-share`,
  and idle 17 hours at capture time — registered a new `verify` lane, so a sweep that trusted a
  five-minute-old snapshot would have removed a worktree that had just gone back to work. Separately,
  `git worktree remove` fails under the sandbox with `error: failed to delete '<path>': Operation not
  permitted`, naming both the worktree directory and its `.git/worktrees/<name>` record; it fails
  before deleting anything, so the worktree survives intact, but the operation needs an unsandboxed
  shell.
  Re-checked on 2026-09-20 against `main` at `e241941a`, after Simplification Waves 1 and 2 and the
  landing-lock rework: still true, and larger. The machine now holds 47 registered worktrees, 19 of
  them `ahead 0` of `main` by `board`'s own reckoning. No reclamation command exists in `./agent
  help`, the `Justfile`, or `packages/dev/dev-src/`, and `board` computes no verdict to act on —
  `Board.ts:258` states the intent outright: "a read-only report leaves cleanup to an explicit `git
  worktree prune`". The word `reclaim` does not appear in `Board.ts` at all. None of the three
  acceptance criteria is met, so nothing here can be downgraded.
- **Workaround:** Build the inventory by hand as above and re-read the lane registry immediately
  before each destructive command, treating any doubt as live. Run `git worktree remove` unsandboxed.
- **Proposed change:** Give `./agent` a reclamation command — `./agent board` already computes most
  of the inputs, including per-worktree clean/dirty and ahead/behind against `main`. It would
  classify each worktree and branch as reclaimable, live, or unclassified from the four liveness
  signals plus containment in `main` or any `origin/merged/*` ref, print the classification, and act
  only on the reclaimable class, re-checking liveness per item at the moment it acts rather than
  from the opening snapshot. A landed task's own worktree is the clearest case: `merge-with-main`
  knows it has just archived the branch, so it could offer to reclaim its worktree then, or record
  the path for the sweep to collect later.
- **Dependencies:** `MachineLanes.ts` owns the lane registry the liveness check reads; `./agent
  board` owns the per-worktree state; `MergeWithMain.ts` owns the leave-it-in-place behavior and the
  `.artifacts/merge/main-worktree` recovery worktree, which a sweep must never remove while a
  snapshot reads `push-started`.
- **Acceptance:** One command reports every worktree and branch with its verdict and the evidence
  behind it, and reclaims the provably idle and provably preserved ones without a hand-built
  inventory. It refuses to remove a worktree that acquires a lane between the report and the action,
  and it runs without an unsandboxed shell or explains why it needs one.
- **Source:** 2026-09-19 worktree and branch sweep.
