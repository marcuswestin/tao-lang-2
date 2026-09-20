# DEVENV-046 — WordFlower remains the tail of the sharded Tao app tests

- **Status:** Candidate
- **Area:** Test performance
- **Impact:** Tao app tests are sharded by app root, but WordFlower owns one indivisible root and remains
  the tail. In verify run `2026-09-20T16-35-46-656Z-96541-45b684e1`, `tao-apps#1` started as soon as its
  dependencies allowed, then ran for 56.9s against an expectation of 53.7s. The 18-slot lane finished
  in 72.7s with 415.1 idle slot-seconds; WordFlower was on the 72.4s serial floor.
- **Evidence:** WordFlower contains five Tao test files and the recorded run executed 29 journeys. Its
  shard held the fixed two-slot reservation, validated with one worker, and could not use capacity
  released by sibling shards. Isolated warm-filesystem observations were 24.93s at two slots, 29.17s
  at four, and 26.52s at eight; each remained one compiler worker and one Jest entrypoint. These are
  single observations rather than a statistical benchmark, but they show no reason to widen the
  shard. A 2026-09-20 refresh in the managed host was blocked before test startup by Node CPU discovery
  (`sysctl kern.clockrate: Operation not permitted`), so the earlier valid observations remain the
  applicable width evidence.
- **Evidence, implementation audit:** The existing compiled-output cache measured roughly 29s cold
  to 6.7s warm for its recorded Tao test run. In the 51.3s WordFlower shard observation, Jest
  accounted for only 6.6s; the remaining cold tail is believed to be dominated by the
  shared-workspace validation and compilation pass. The five
  test files deliberately run serially on one compiler worker so they observe one consistent
  workspace. A runtime improvement therefore requires either dependency-correct cache narrowing or
  a safely partitioned compiler workspace, both of which materially increase correctness complexity.
- **Workaround:** `just test-changed` skips tao-apps when no `Apps/` or `.tao` file changed.
- **Proposed change:** Keep the two-slot WordFlower reservation and the shared app-root workspace.
  Do not widen, elastically resize, or split the shard with the current evidence. If performance work
  resumes, first add opt-in phase timings for discovery, fingerprint/cache lookup, validation,
  compilation, entrypoint generation, and Jest; use those measurements to justify any later
  correctness-sensitive workspace or cache change.
- **Dependencies:** DEVENV-034 (Bun worker pool) is separate. Elastic allocation and finer workspace
  splitting are not warranted by the present width measurements.
- **Acceptance:** `_test` wall under 20s uncontended with the same test inventory.
- **Source:** 2026-09-04 development-speed review; 2026-09-20 sharded scheduler follow-up.
