# DEVENV-LAZY-TEST-REGISTRATION-FAILS-CI-IMPORT — Lazy test registration fails CI import

- **Status:** In progress
- **Section:** External
- **Area:** Shared test wrapper and GitHub verification
- **Impact:** Accessing the native runner's lazy `only` accessor while initializing ordinary shared
  test wrappers aborts every affected suite before test registration in CI.
- **Evidence:** Main `b79e2dfca1c9` introduced eager registration-variant reads in `setTestRuntime`.
  GitHub Verify run `37394051451`, integrated head `623458a513e3`, failed with
  `.only is disabled in CI environments to prevent accidentally skipping tests` at `Test.ts:263`.
  Partition 6 job `112045666944` recorded this import failure across shared and dependent suites.
  The timeout patch's prior run `37387058364` passed before this main integration. No local tests
  were run during diagnosis; the failed GitHub run is the reproduction.
- **Workaround:** None that preserves CI's focused-test safeguard. Disabling CI globally would
  weaken the protection and is not an acceptable fix.
- **Proposed change:** Keep registration accessors lazy while wrapping timeout arguments; ordinary
  import must not access `only`, and explicitly using `Test.only` in CI must still be rejected.
  Controlled timeout-forwarding fixtures may opt out of CI only inside their isolated child process.
- **Dependencies:** Fix is owned by `feat/ci-timeout-headroom`. Replacement GitHub run `37395646036`
  passed every portable partition with the focused-test guard preserved. Landing is held while the
  Developer's combined macOS workflow and CI priority batch is implemented and verified.
- **Acceptance:** A subprocess regression proves ordinary registration initializes under `CI=true`
  and focused registration remains rejected; the integrated head passes full portable GitHub Verify.
- **Source:** GitHub CI logs from run `37394051451`, captured under the task's
  `.artifacts/ci-verification-37394051451/` directory.
