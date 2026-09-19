# DEVENV-046 — The tao-apps suite is one 22-second process on the test critical path

- **Status:** In progress
- **Area:** Test performance
- **Impact:** `_test` wall time (29.5s) is set by `tao-apps`, a single Jest process that runs all 26 Tao
  behavior test files after a serial validate and compile phase.
- **Evidence:** 2026-09-04 verify lane: `tao-apps` 21.7s (Jest phase 15.1s, validate with 8 workers plus
  compile about 6s); next longest suites `runtime-toolchain` 13.9s, `runtime-jest` 12.6s, `studio` 12.2s;
  suite sum 104s on 18 CPUs. By 2026-09-19 main had added graph-level shard scheduling with Tao app
  roots as shard units plus the compiled-app cache. That architecture supersedes a second static shard
  layer inside Jest, which would multiply child processes and over-reserve the machine.
- **Workaround:** `just test-changed` skips tao-apps when no `Apps/` or `.tao` file changed.
- **Proposed change:** Keep main's graph-level app-root sharding and compiled-app cache as the sole
  parallelism layer. Measure it before changing shard cost or adding any inner Jest sharding.
- **Dependencies:** DEVENV-034 remains a separate Bun-worker question; DEVENV-079 and DEVENV-081 provide
  the process bounds and compiled-output cache this path now relies on.
- **Acceptance:** Three uncontended complete-test runs preserve the Tao test inventory, show median
  `tao-apps` duration below 20 seconds, and improve complete test wall time at least 15% from the
  27.1-second baseline. Performance evidence is still pending because this reconciliation ran under
  eight to ten simultaneous Tao lanes.
- **Source:** 2026-09-04 development-speed review.
