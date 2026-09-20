# DEVENV-109 — The dev-data cross-process test times out under a full lane

- **Status:** Candidate
- **Area:** Test reliability, `packages/dev`
- **Impact:** `verify` fails on a branch that did not break it, and `finalize` stops with it. One
  re-run costs a whole lane because the failed record covers the tree.
- **Evidence:** 2026-09-19, `./agent finalize` on `feat/simplify-repo-wave-1`:
  `(fail) dev data server > serializes CAS and observes resets from an independent authority process [5404.96ms]`
  with `No dev data event arrived within 5s.` at `packages/dev/dev-tests/dev-data.test.ts:515`. The
  same file then passed three of three runs alone, and the next full lane passed on the same tree.
  The lane that failed ran beside another Tao lane. The branch's one edit to `DevDataServer.ts`
  (`errorCode` through `Json.isRecord`) keeps `Error` instances, so it is not the cause.
- **Workaround:** Re-run the lane.
- **Proposed change:** The 5s wait bounds a second process's startup plus a filesystem-serialized
  CAS, both of which stretch under load. Wait on the authority process's readiness signal before
  starting the clock, or scale the bound from the lane's measured contention.
- **Dependencies:** None.
- **Acceptance:** Twenty consecutive `verify` runs beside a second lane with no failure in this test.
- **Source:** 2026-09-19 repository simplification, Wave 1 finalize.
