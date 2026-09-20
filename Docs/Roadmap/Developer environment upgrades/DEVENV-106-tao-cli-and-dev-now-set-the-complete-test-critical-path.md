# DEVENV-106 — Tao CLI and dev now set the complete-test critical path

- **Status:** Candidate
- **Area:** Test performance
- **Impact:** Graph-level Tao app sharding removed `tao-apps` from the critical path, but complete-test
  wall remains above the old 27.1-second baseline because `tao-cli` and `dev` now dominate every run.
- **Evidence:** Three uncontended `just test-all` runs on 2026-09-20 completed in 36.9s, 35.6s, and
  31.9s. `tao-cli` took 28.6s, 27.7s, and 28.3s despite expanding to 21, 25, and 27 graph shards;
  `dev` took 25.6s, 24.2s, and 24.2s as one process. In the same runs `tao-apps` had already fallen
  to a 14.4s median while preserving all 29 current Tao test files.
- **Workaround:** Use changed-file selection during iteration; complete verification still pays the
  full `tao-cli` and `dev` suites.
- **Proposed change:** Profile the longest `tao-cli` shard and the unsharded `dev` suite, then reduce
  their serial setup or rebalance only the files whose recorded costs dominate. Do not add more
  `tao-cli` processes blindly: the scheduler already reached 27 shards without moving its wall time.
- **Dependencies:** Keep DEVENV-046's graph-level Tao sharding and DEVENV-081's compiled-app cache.
- **Acceptance:** Three uncontended complete-test runs preserve the full suite inventory and reduce
  median wall time at least 15% from the new 35.6-second baseline, below 30.3 seconds, without
  increasing peak process count merely to hide unchanged serial work.
- **Source:** 2026-09-20 DEVENV-046 acceptance measurements.
