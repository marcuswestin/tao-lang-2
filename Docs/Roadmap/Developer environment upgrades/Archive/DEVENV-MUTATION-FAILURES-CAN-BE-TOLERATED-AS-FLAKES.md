# DEVENV-MUTATION-FAILURES-CAN-BE-TOLERATED-AS-FLAKES — Mutation failures can be tolerated as flakes

- **Status:** Resolved
- **Section:** External
- **Area:** Verification evidence
- **Impact:** Deliberate production-code mutations can teach the test ledger that a
  deterministic lifecycle test is flaky. A later mutation run can then return a
  successful command verdict despite the expected failing assertions.
- **Evidence:** On 2026-09-26, `feat/summary-cache-cleanup` ran the unchanged
  `cache-process-lifecycle.test.ts` through `./agent test-file` against working
  code, then mutations disabling live-owner protection, locking, and dead-owner
  retirement. The retirement mutation produced three failed assertions, but the
  wrapper reported `dev-test: PASSED in 377ms — tolerating 3 known flakes`.
  The raw log retained all three failures. Task-local evidence is
  `.artifacts/logs/agent/test-file/2026-09-26T21-58-48-960Z-49725.log`.
  `TestLedger` keys tolerance to the test file's identity; these mutations changed
  the implementation without changing that identity. This was induced mutation
  history, not an observed intermittent failure in the original implementation.
- **Workaround:** Inspect raw assertion results for mutation runs and the restored
  control; do not treat the wrapper's exit status alone as mutation evidence.
- **Proposed change:** Give deliberate mutation runs an explicit mode that neither
  applies flake tolerance nor contributes ordinary flake history, and make the
  result identify that mode. Keep ordinary failure records intact.
- **Dependencies:** Test ledger and runner policy.
- **Acceptance:** A deliberate failing mutation exits nonzero even when the test
  has an existing tolerated-flake record. Alternating deliberate red and green
  controls cannot make an otherwise deterministic test eligible for tolerance.
  The restored control still records and reports actual assertion results.
- **Source:** Cache lifecycle acceptance, 2026-09-26.

- **Resolution:** Implemented `./agent test-mutation <path>` with a separate evidence mode and artifact lane. Mutation runs preserve raw failure verdicts, bypass automatic retries and flake tolerance, and leave ordinary ledger, history and learned timings untouched. Fixture controls prove pre-existing tolerated history cannot mask a deliberate failure and alternating red/green controls do not change evidence bytes; ordinary behavior remains covered.
- **Archived:** 2026-09-27.
