# DEVENV-092 — Simultaneous worktree finalizations collapse verification throughput

- **Status:** Candidate
- **Area:** Parallel verification
- **Impact:** Every agent finishing its task runs the repository's heaviest lane at the same moment,
  so the fair share per lane falls to one or two slots and a lane that takes well under a minute
  alone takes many minutes. This is the largest single component of "finalizing takes far longer
  than expected", and it grows with the number of active worktrees rather than with the change.
- **Evidence:** 260 recorded non-`dev-test` lane runs across every checkout, bucketed by how many
  other lane runs overlapped them: one lane median 37.8s (p90 88.1s), two 54.7s (p90 207.5s), three
  75.8s (p90 390.4s), four 691.3s, five 366.3s — superlinear, not proportional. On 2026-09-17 at
  17:01 local, `ps` showed eight gate-runner processes plus a `full-verify` and a
  `merge-with-main`, and `~/.cache/tao/machine-lanes` held 13 live lane records — none stale —
  holding **two admitted slots between them** while 16 of 18 CPUs' worth of budget went unissued.
  A control `verify --complete` started in this worktree at that moment took **721.5s against a
  32.5s uncontended median, 22x**, reporting `13 Tao lanes ran at once; load peaked at 36.2 on 18
  CPUs`; within it `_test` took 266.6s against ~34s, `_fix-tao` 107.5s against 3.3s, and
  `_compile-word-flower-app` 18.1s against 0.65s. Two candidate causes to separate: the fair-share
  floor gives each of 13 lanes a ceiling of one or two slots, and every admission decision takes
  the single advisory registry lock, so 13 contenders may spend admission in lock contention rather
  than in work.
- **Workaround:** Verify when the machine is quiet, or read the `contention` block in
  `summary.json` before treating a slow lane as a regression.
- **Proposed change:** Admit whole heavy lanes machine-wide in arrival order rather than splitting
  the machine between all of them at once, so two or three lanes run at full width and the rest
  queue with a printed position; reconcile admitted slots with real CPU use, since 13 lanes holding
  one slot each drove load to 28 on 18 CPUs, which means a slot does not describe what a suite
  actually spawns.
- **Dependencies:** `MachineLanes.ts` `fairAllocations` and the `WorkGraph` reservation path;
  builds on DEVENV-001 rather than replacing it.
- **Acceptance:** With ten lanes requested at once, the median completion time of the first three is
  within 1.5x of the uncontended median, and total wall time for all ten beats today's fair-share
  behavior.
- **Source:** 2026-09-17 merge-finalization performance investigation.
