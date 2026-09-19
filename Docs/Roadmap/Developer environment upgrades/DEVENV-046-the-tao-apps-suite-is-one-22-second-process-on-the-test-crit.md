# DEVENV-046 — The tao-apps suite is one 22-second process on the test critical path

- **Status:** Candidate
- **Area:** Test performance
- **Impact:** `_test` wall time (29.5s) is set by `tao-apps`, a single Jest process that runs all 26 Tao
  behavior test files after a serial validate and compile phase.
- **Evidence:** 2026-09-04 verify lane: `tao-apps` 21.7s (Jest phase 15.1s, validate with 8 workers plus
  compile about 6s); next longest suites `runtime-toolchain` 13.9s, `runtime-jest` 12.6s, `studio` 12.2s;
  suite sum 104s on 18 CPUs.
- **Workaround:** `just test-changed` skips tao-apps when no `Apps/` or `.tao` file changed.
- **Proposed change:** Shard the Tao behavior tests across two or three Jest processes, or cache compiled
  apps between runs so only changed apps recompile.
- **Dependencies:** DEVENV-034 (Bun worker pool) is a separate question; revisit the `tao-apps` `cost: 8`
  reservation after sharding.
- **Acceptance:** `_test` wall under 20s uncontended with the same test inventory.
- **Source:** 2026-09-04 development-speed review.
