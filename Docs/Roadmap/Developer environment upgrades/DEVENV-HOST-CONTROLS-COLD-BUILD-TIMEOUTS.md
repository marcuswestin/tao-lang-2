# DEVENV-HOST-CONTROLS-COLD-BUILD-TIMEOUTS — Host controls cold builds time out

- **Status:** Candidate
- **Section:** External
- **Area:** Host-free fixture preparation
- **Impact:** An unchanged cold-build fixture can make driver control verification fail before
  its assertions execute, complicating source regression assessment.
- **Evidence:** The 2026-10-06 UI-driver pass first completed all 184 host controls in 208.9s.
  A deliberate driver mutation run also timed out preparing the Syntax2 LibraryApp. After restoring
  the drivers, a 282.1s run passed 182 controls but timed out both cold-build tests in
  `app-build/HostBuild.host.spec.ts`: native-navigation at its 90s bound and Syntax2 at 180s.
  Logs: `.artifacts/logs/agent/test-host/2026-10-06T18-15-36-440Z-2332.log` and
  `.artifacts/logs/agent/test-host/2026-10-06T18-28-57-558Z-76118.log`.
  Other lanes reported heavy machine contention at the same time; its causal role is unproved.
- **Workaround:** Preserve failed receipts, distinguish fixture preparation from driver assertion
  failures, and rerun unchanged source with fewer competing lanes.
- **Proposed change:** Measure preparation and subprocess lifetime in these cold-build controls;
  choose isolation or reuse only after finding the bottleneck. Do not merely increase UI timeouts.
- **Dependencies:** Coordinate with current test process-lifecycle and verification performance work.
- **Acceptance:** Repeated cold runs finish within their existing bounds on the intended host
  capacity, and a timed-out build leaves no owned worker running.
- **Source:** 2026-10-06 UI-driver regression and integration verification.
