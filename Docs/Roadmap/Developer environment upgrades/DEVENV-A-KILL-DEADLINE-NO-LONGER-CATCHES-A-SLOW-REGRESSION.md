# DEVENV-A-KILL-DEADLINE-NO-LONGER-CATCHES-A-SLOW-REGRESSION — A kill deadline no longer catches a slow regression

- **Status:** Candidate
- **Section:** External
- **Area:** Verification diagnostics
- **Impact:** The Bun per-test budget rose from 7.5s to 45s so that its floor clears the `until`
  helper's 30s default and a wait's own description reaches the report before Bun's anonymous
  kill. Measured against the test ledger, 1 of 4,613 non-concurrent tests ever exceeded 45s, so the
  budget is now a hang guard in all but name: a test that regresses from 50ms to 40s passes in
  silence where the old 8s idle-machine wall would have failed it. Separately, the slowest
  single-threaded test (`tutorials.test.ts`, the finished first-app tutorial's behaviour test) runs
  about 34s on an idle host against the flat 45s floor, which is 1.3x of headroom before the
  load-scaled deadline begins to stretch.
- **Evidence:** `packages/testing/verification/verification-src/TestRunner.ts`
  (`TEST_BUDGET_MS`, `MAX_TEST_DEADLINE_MS`, `starvationAdjustedTimeoutMs`) and the review of the
  change that landed on 2026-09-22; the per-test figures are `.artifacts/testing/ledger.json`'s
  recorded `durationMs`, under whatever load those runs saw.
- **Workaround:** None needed for correctness; a slow regression is only invisible to the deadline,
  not to the ledger, which records every test's duration on every run.
- **Proposed change:** Recover the regression signal from the ledger rather than from a kill: a
  gate that compares each test's recorded duration against its own history (a moving median per
  test) and reports the ones that grew by more than a factor, on an idle machine only, so the
  question "did this test get slower" is answered by data a deadline cannot see. Consider a
  per-suite floor override for the tutorial suite if its slowest test approaches the flat floor.
- **Dependencies:** DEVENV-FIXED-SHORT-TIMEOUTS-LOSE-TO-CONTENTION (archived) is the change that
  made the deadline a hang guard; this entry is what that change gave up.
- **Acceptance:** A test whose duration grows by an order of magnitude on an idle machine is named
  by a gate, without any wall-clock kill having to fire.
- **Source:** 2026-09-22 review of the load-tolerant test budgets landing.
