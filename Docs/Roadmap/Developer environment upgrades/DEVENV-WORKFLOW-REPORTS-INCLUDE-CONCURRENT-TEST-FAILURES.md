# DEVENV-WORKFLOW-REPORTS-INCLUDE-CONCURRENT-TEST-FAILURES — Workflow reports include concurrent test failures

- **Status:** Candidate
- **Section:** External
- **Area:** Workflow diagnostics
- **Impact:** A command's final failure summary can name a concurrent command's failed test, obscuring
  the failure that actually belongs to the command being reported.
- **Evidence:** The iPad `test-host` report at
  `.artifacts/logs/agent/test-host/2026-09-26T16-59-01-686Z-46962.log` named the compiler exploration
  `bounds interruption analysis for a recursive inline command action` in its `Failed` block. That
  compiler test ran independently during the host command. The iPad proof receipt instead records
  its actual failure: expected visible text `Notes workspace`. The host build completed and reached
  Appium; it did not run that compiler test as an acceptance step.
- **Workaround:** Read the command's own proof receipt and captured output before assigning a
  failure to it. Preserve the original report when recording the discrepancy.
- **Proposed change:** Bind summarized test failures to the invocation or lane that produced them,
  rather than including other newly written records from the same checkout.
- **Dependencies:** None.
- **Acceptance:** Run one deliberately failing focused test concurrently with an independent host
  command. Each report includes only its own failures, while retaining its real verdict and logs.
- **Source:** 2026-09-26 native-navigation acceptance.
