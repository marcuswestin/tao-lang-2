# DEVENV-075 — A tracked process was re-identified by a name that changes at `exec`

- **Status:** Resolved
- **Area:** Process supervision
- **Impact:** `ProcessTree.sameProcess` compared a tracked process's `command` as well as its start
  time. `command` is the kernel process name, which changes at `exec`; the start time is set at
  `fork` and never moves. Any process captured between the two therefore failed to match itself
  afterwards. The visible symptom was `process-supervision.test.ts` reporting a live `sleep 300` as
  dead, which failed a lane under load roughly one run in five. The consequential half was silent
  and pointed the other way: `signalTrackedProcesses` skipped a descendant that had exec'd since the
  snapshot — the runaway the module exists to stop — and `waitForTrackedProcessesExit` declared such
  a tree gone while it was still running. `CLI.start`'s `test` policy caches its descendant list
  once and reuses it across the 250ms SIGKILL escalation, so the window was milliseconds wide.
- **Evidence:** the same PID, read 750ms apart across the exec:
  `{"command":"bash","pid":91220,"startedAt":"1789812267:567095"}` then
  `{"command":"coreutils","pid":91220,"startedAt":"1789812267:567095"}`. A replica of the test's tree
  setup that signals nothing at all, run 140 times under 24 CPU spinners and 24 fork/exec churners,
  captured the pre-exec name in 25 of 140 runs; `/bin/kill -0` confirmed every one of those 25
  processes alive at the instant the identity check called them dead. `startedAt` was byte-identical
  in all 25. Unloaded, 0 of 20 reproduced.
- **Why the first investigation missed it:** it recorded this hypothesis as disproved because a wait
  for the identity to report an exec'd `sleep` never came true. It never came true because the
  devenv `sleep` is uutils, whose process name is `coreutils`, not `sleep` — so the predicate was
  searching for a string that could not appear, and the hypothesis was never actually tested.
- **Change made:** identity is the start time alone. `command` is kept as a descriptive field and
  deliberately not compared, with the reason recorded where the comparison lives. A unit test pins
  the direction that matters: a descendant whose name changed since the snapshot is still signalled.
- **Dependencies:** none.
- **Acceptance:** `process-supervision.test.ts` passes under deliberate load, and signalling a
  tracked descendant that exec'd since the snapshot still reaches it.
- **Source:** 2026-09-19, diagnosed after the assertions blocked two `verify` runs.
- **Archived:** 2026-09-19
