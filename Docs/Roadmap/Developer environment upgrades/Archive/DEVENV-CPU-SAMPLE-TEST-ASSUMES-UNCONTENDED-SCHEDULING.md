# DEVENV-CPU-SAMPLE-TEST-ASSUMES-UNCONTENDED-SCHEDULING — CPU sample test assumes uncontended scheduling

- **Status:** Resolved
- **Area:** Test execution
- **Impact:** A loaded verification lane can fail an unchanged timing test because a CPU-bound child
  spends enough wall time waiting to fall below the timing store's CPU plausibility threshold.
- **Evidence:** On 2026-09-26, `feat/verification-scheduling-priority` ran `verify-changed` with five
  concurrent lanes and peak load 94.2 on 18 CPUs. `run-artifacts.test.ts`'s "records a real node's own
  CPU time as its duration, once it clears the plausibility floor" expected source `cpu` but received
  `wall`. The lane log is `.artifacts/logs/verify-changed/2026-09-26T22-12-18-267Z-51413-4f15a9f4/`.
  The file passed immediately in isolation via `./agent test-file
  packages/testing/verification/verification-tests/run-artifacts.test.ts`. That lane does not apply
  the new full-verification priority policy. The fixture's comment assumes its tight loop spends
  nearly all elapsed time on CPU; a busy scheduler does not guarantee that.
  Fixed on `feat/verification-scheduling-priority` on 2026-09-26. Temporarily stretching the real
  child's recorded wall time to ten times its CPU time reproduced the exact `cpu` versus `wall`
  failure without changing CPU accounting. The repaired file passed with two overlapping lanes
  and peak load 127.1 on 18 CPUs. Removing the real runner's CPU assignment and changing the
  threshold comparison from inclusive to exclusive each failed the corresponding regression;
  both mutations were restored before the passing run.
- **Workaround:** None needed after the test repair.
- **Proposed change:** Separate real child CPU-accounting evidence from deterministic timing-store
  threshold assertions, preserving coverage for CPU preference and wall-time fallback without
  requiring a host CPU-to-wall-time ratio. Implemented as a real-process test asserting finite,
  positive CPU accounting and exact persistence of both measurements, plus fixed samples at and
  immediately below the 20% threshold asserting the selected source and duration. Production
  timing policy and test timeouts are unchanged.
- **Dependencies:** None.
- **Acceptance:** The integration test proves CPU-accounting propagation under contention, and
  deterministic cases prove both sides of the plausibility threshold without wall-clock assumptions.
- **Source:** 2026-09-26 scheduling-priority verification; kept separate from the requested priority-only change.
- **Archived:** 2026-09-26
