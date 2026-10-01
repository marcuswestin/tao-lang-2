# DEVENV-IDLE-RESET-FIXTURE-ASSUMES-SLEEP-CADENCE — Idle-reset fixture assumes sleep cadence

- **Status:** Resolved
- **Section:** External
- **Area:** Process supervision test fixture
- **Impact:** The idle-reset test can fail broad host verification because it expects a real shell
  sleeping 150ms between outputs to stay within a 500ms idle bound under scheduling load.
- **Evidence:** `finalize` on `feat/test-responsibility` stopped at `shared#1`: the output-reset test
  expected exit code 0 and received null after 944ms. Its neighboring real idle-stop test passed.
  The entire focused process-supervision file then passed 15/15. Failure log:
  `.artifacts/logs/verify/2026-10-01T19-33-22-800Z-8510-3a0295de/shared_1.log`; focused log:
  `.artifacts/logs/dev-test/2026-10-01T19-34-42-809Z-15949-68f2c05b/shared.log`.
  [POSIX scheduling guidance](https://pubs.opengroup.org/onlinepubs/009696799/functions/sleep.html)
  permits sleep to last longer under system scheduling; a timely output cadence is no tool guarantee.
  DEVENV-075 concerns identity across exec and is unrelated; the archived fixed-short-timeout entry
  describes the general scheduling hazard, while this fixture specifically tests idle-output reset.
  The replacement passes 15/15; deliberately removing output-triggered `restartIdleBound()` fails
  it at the original idle deadline. Mutation log:
  `.artifacts/logs/agent/test-mutation/2026-10-01T19-55-44-417Z-21011.log`; production code was restored.
- **Workaround:** Run the affected file alone to diagnose, then repeat broad verification; an isolated
  pass does not complete the interrupted broad lane.
- **Proposed change:** Implemented: keep the real child and pipes, control only its idle timer, and advance virtual
  time while output is delivered. Preserve adjacent real timeout and process-tree cleanup tests.
- **Dependencies:** None; no production, dependency, permission, or timing-policy changes required.
- **Acceptance:** The replacement crosses the original idle deadline without a bound failure when
  output restarts it; removing that restart fails the test. The file passes after restoration and
  restores timers and terminates its owned child on every exit path.
- **Source:** 2026-10-01 finalization of the test responsibility audit.
