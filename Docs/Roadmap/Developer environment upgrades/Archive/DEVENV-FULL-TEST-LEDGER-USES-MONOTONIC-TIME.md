# DEVENV-FULL-TEST-LEDGER-USES-MONOTONIC-TIME — Full-test ledger uses monotonic time

- **Status:** Resolved
- **Section:** External
- **Area:** Verification evidence and retry selection
- **Impact:** Gate verification recorded a process-relative timestamp as its full-run calendar
  boundary, allowing older passing observations to appear newer than that boundary during retries.
- **Evidence:** The local ledger contained `lastFullRunStartedAt: "1970-01-01T00:00:00.095Z"`.
  `GateRunner` passed `Time.nowMs()` to `TestLedger.recordRun`, which stores an ISO calendar date.
  The gate regression pins monotonic time to 123 and wall time to 2026-10-01, then verifies that a
  partial fail-fast run does not replace the complete-run boundary. Substituting the monotonic
  timestamp and removing the completeness guard each fail that regression. Logs:
  `.artifacts/logs/agent/test-mutation/2026-10-01T19-55-05-489Z-17766.log` and
  `.artifacts/logs/agent/test-mutation/2026-10-01T19-55-26-978Z-19661.log`.
  The existing native-capture and machine-lease clock entries cover different owners.
- **Workaround:** Repeat complete verification after the fix; old evidence was not rewritten.
- **Proposed change:** Implemented: capture `Date.now()` for the ledger boundary while retaining
  monotonic timing for gate durations and scheduling.
- **Dependencies:** None; retry policy, dependencies, and permission reach are unchanged.
- **Acceptance:** A complete run records its wall-clock start, and a subsequent aborted run keeps
  that boundary. Both deliberate regressions fail; the restored gate test passes.
- **Source:** 2026-10-01 finalization evidence review during the test responsibility audit.
