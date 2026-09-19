# DEVENV-079 — A per-test timeout measured in wall time judges the machine, not the test

- **Status:** Resolved
- **Area:** Test execution
- **Impact:** Bun's per-test deadline is wall time, which is the work a test performed plus the time
  it spent off CPU waiting for other lanes. A fixed deadline therefore makes the pass/fail judgment
  a function of how busy the machine is, which is not a property of the test. The standing remedy —
  raising the suite to a flat 60 seconds — buys that tolerance by giving up the budget entirely: a
  test that genuinely regressed from 1.4 to 40 seconds would pass in silence.
- **Evidence:** On 2026-09-19, `studio#2` timed out with four lanes in flight at load 41.1 on 18
  CPUs. The shard was not slow as a whole; one test was killed, `Studio browser assets produce a
  self-contained CodeMirror client` (`packages/studio/studio-tests/studio-client.test.ts:137`),
  which compiles `TaoStudioClient.tao` in release mode and runs a minifying `Bun.build` of React and
  CodeMirror. It measured 5162.81ms against the 5000ms default and 1380.54ms on the isolated retry —
  3.7x. The next-slowest test in that shard was 624ms, so nothing else was near the bound. `studio`
  had no `SUITE_TUNING` entry at all, while `dev`, `runtime-toolchain`, and `tao-cli` each carry
  `--timeout=60000` with a comment describing this same failure. DEVENV-035 is the single-test
  instance of it, remedied there by one explicit 30-second bound that then timed out again.
- **Workaround:** The contention retry already covers it — `classifyFailure` labels the timeout
  `machine-contention` and the isolated re-run passes — but it pays a retry on every busy run.
- **Change made:** `bunSuite` now emits one explicit `--timeout` for every suite that does not
  declare its own. The budget stays fixed at Bun's five seconds, so an uncontended machine keeps
  exactly today's judgment and a real regression is still caught; only the deadline stretches, by
  the run-queue depth the machine is actually carrying, capped at the 60 seconds this repository
  already accepts as "only a hang trips it". The one-minute load average lags what a running test
  feels — this run read 2.3x by load while the killed test ran 3.7x slower — so the observed ratio
  is doubled before it is applied.
- **Dependencies:** Adjacent to DEVENV-077 and DEVENV-078, which are the admission side of the same
  pressure: slots do not bound CPU demand, so lanes exceed their own capacity (`this lane holds 16
  of its 9 slots` in the same run) and wall time stops approximating work.
- **Acceptance:** Every Bun suite carries exactly one per-test bound; an idle machine yields 5000ms;
  the run above's load yields a deadline clearing its measured 3.7x; a suite with its own bound
  keeps it unscaled, because scaling a hang guard is meaningless.
- **Not done:** The budget is still one constant for every test rather than each test's own recorded
  cost. `TestLedger` already keeps a rolling per-test `durationMs` (`TestLedger.ts:138`) that nothing
  reads for this purpose; sourcing the budget from it, gated on `contention.contended === false` so a
  contended run reads but does not write, would make the bound a real per-test budget. That is the
  larger change this one deliberately stops short of.
- **Source:** 2026-09-19 `studio#2` contention retry, `.artifacts/logs/dev-test/2026-09-19T00-57-27-791Z-50570-63e99413`.
- **Archived:** 2026-09-19
