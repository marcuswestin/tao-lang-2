# DEVENV-046 — The tao-apps suite is one 22-second process on the test critical path

- **Status:** Resolved
- **Area:** Test performance
- **Impact:** `_test` wall time (29.5s) was set by `tao-apps`, a single Jest process that ran every Tao
  behavior test file after a serial validate and compile phase.
- **Evidence:** The 2026-09-04 verify lane measured `tao-apps` at 21.7s (Jest phase 15.1s, validate with
  8 workers plus compile about 6s); the next longest suites were `runtime-toolchain` at 13.9s,
  `runtime-jest` at 12.6s, and `studio` at 12.2s, with 104s of suite work on 18 CPUs. By 2026-09-19
  main had added graph-level shard scheduling with Tao app roots as shard units plus the compiled-app
  cache. That architecture superseded a second static shard layer inside Jest, which would multiply
  child processes and over-reserve the machine.
- **Workaround:** `just test-changed` skips tao-apps when no `Apps/` or `.tao` file changed.
- **Change made:** Kept main's graph-level app-root sharding and compiled-app cache as the sole
  parallelism layer; the attempted inner-Jest sharding was retired before landing.
- **Dependencies:** DEVENV-034 remains a separate Bun-worker question; DEVENV-079 and DEVENV-081
  provide the process bounds and compiled-output cache this path now relies on.
- **Acceptance:** Three uncontended `just test-all` runs on 2026-09-20 discovered all 29 current Tao
  test files and measured `tao-apps` at 14.4s, 15.8s, and 8.9s: a 14.4s median, below the 20s target.
  The planned inventory of 30 was stale; the repository contained 29 before this branch and all 29
  ran each time. Complete-test wall was 36.9s, 35.6s, and 31.9s rather than improving from the old
  27.1s baseline because the corpus and graph had grown; `tao-cli` (27.7–28.6s) and `dev`
  (24.2–25.6s) are now the critical path. Per this entry's stated exception, DEVENV-106 records the
  new bottleneck rather than keeping this retired bottleneck open.
- **Source:** 2026-09-04 development-speed review.
- **Archived:** 2026-09-20
