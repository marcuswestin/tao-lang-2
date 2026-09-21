# DEVENV-031 — Intermittent inspection-output anomalies

- **Status:** Candidate
- **Section:** External
- **Area:** Host tooling
- **Impact:** One `rg` result appeared mangled and a one-off status read did not immediately show an
  untracked file, which can mislead concurrent review.
- **Evidence:** Each occurred once and was not reproduced.
- **Workaround:** Repeat the read, pin review to a commit, and run final status/diff checks after concurrent
  writers finish.
- **Proposed change:** Collect a reproducible command and raw output before changing repository tooling.
- **Dependencies:** External host behavior or concurrent filesystem timing.
- **Acceptance:** Either reproduce deterministically and open a scoped fix, or close after repeated clean
  observations.
- **Source:** 2026-09-03 companion and semantic-agent implementation briefings.
