# DEVENV-034 — Bun worker-pool test scheduling

- **Status:** Candidate
- **Area:** Test performance
- **Impact:** Replacing the package-process scheduler with Bun's worker pool is not currently safe: the
  comparison workload can fail timing-sensitive tests or fail to terminate.
- **Evidence:** With no peer Tao lanes on an 18-CPU host, the first cache-disabled package-process
  sample finished red in 10.9 seconds (one five-second bootstrap timeout and one missed overlap
  assertion). The equivalent `bun test --parallel=18 --isolate` workload had not completed after 150
  seconds and was stopped. The requested repeated cold/warm series was therefore abandoned rather
  than multiplying potentially orphaned worker processes.
- **Workaround:** Keep the current one-process-per-package scheduler and its machine-wide admission
  broker.
- **Proposed change:** After active branches land, isolate the worker-pool hang on a smaller package set,
  add a process-tree timeout to the benchmark, then collect three green cache-disabled and three green
  warm samples for both schedulers before considering simplification.
- **Dependencies:** Re-check after the large feature branches land; DEVENV-016 and DEVENV-030 own host
  process visibility and cleanup constraints.
- **Acceptance:** Both modes finish the same test-file inventory without failures or surviving workers,
  and repeated measurements show a clear wall-time win before scheduling changes are proposed.
- **Source:** 2026-09-03 measurement on `feat/verification-lanes`; Bun 1.3.13, 18 workers.
