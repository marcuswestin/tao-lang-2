# DEVENV-METRO-FAILS-TO-START-WITHIN-ITS-WAIT-UNDER-CONTENTION — Expo Metro intermittently fails to start within its wait under machine contention

- **Status:** Candidate
- **Section:** External
- **Area:** Studio smoke lanes, full verification
- **Impact:** A `studio-smoke` host lane inside a landing can fail on nothing the branch under test
  changed, because the Metro bundler it starts does not come up inside the lane's wait when the
  machine is busy. The failure reads as a Studio defect until it is re-run and passes.
- **Evidence:** Observed once on 2026-09-21, during a landing under machine contention: the
  `studio-smoke` host lane failed waiting for Metro to start, then passed on an immediate retry with
  nothing else changed. Not root-caused — no sample of what the wait actually measured (Metro's own
  startup time, port contention, or the lane's admission delay eating into the wait's budget) was
  captured before the retry cleared it.
- **Workaround:** Retry the `studio-smoke` lane once; it has passed every time observed so far.
- **Proposed change:** Capture what the wait is timing (Metro process start vs. bundler-ready
  response) the next time this reproduces, so the fix is aimed at the right stage; this is one
  instance of the general class DEVENV-FIXED-SHORT-TIMEOUTS-LOSE-TO-CONTENTION describes, so a fix
  there (an event to wait on instead of a clock) may cover it without a Metro-specific change.
- **Dependencies:** DEVENV-FIXED-SHORT-TIMEOUTS-LOSE-TO-CONTENTION for the general pattern.
- **Acceptance:** A `studio-smoke` lane started under measured contention starts Metro within its
  wait, or the wait's failure names what it was still waiting for.
- **Source:** 2026-09-21 repository-simplification wrap-up, observed during a landing.
