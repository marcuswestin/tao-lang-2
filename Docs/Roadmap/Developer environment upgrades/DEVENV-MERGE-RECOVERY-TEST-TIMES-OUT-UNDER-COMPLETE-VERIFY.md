# DEVENV-MERGE-RECOVERY-TEST-TIMES-OUT-UNDER-COMPLETE-VERIFY — Merge recovery test times out under complete verification

- **Status:** Candidate
- **Section:** External
- **Area:** Complete verification and landing tests
- **Impact:** A complete gate can fail after two minutes on one real-Git merge recovery fixture even when the same test file finishes quickly by itself, delaying an otherwise ready branch and leaving the full-tree proof incomplete.
- **Evidence:** On 2026-09-24, `./agent unsandboxed finalize` failed `testing/verification` because `merge-with-main > recovers an accepted atomic push whose process result was lost` hit its 120,000 ms test timeout. The complete run's other suites, including `tao-apps`, passed. Immediately afterward, `./agent test-file packages/testing/verification/verification-tests/merge-with-main.test.ts` passed all 57 tests in 829 ms. The failure log is `.artifacts/logs/verify/2026-09-24T22-23-52-436Z-5415-5e143c81/testing_verification.log`; the focused pass is `.artifacts/logs/dev-test/2026-09-24T22-26-21-794Z-11656-0a76cf83/testing_verification.log`.
- **Workaround:** Run the focused file to distinguish a repeatable test failure from a complete-lane stall. Keep the full gate marked failed until a complete rerun passes.
- **Proposed change:** Trace the real-Git fixture's child-process and temporary-repository steps under a parallel complete lane, then remove the contention or give the fixture an explicit isolated resource and a diagnostic timeout that names the blocked step.
- **Dependencies:** This is additional complete-lane evidence for [Tests that spawn Git hang in lanes](DEVENV-TESTS-THAT-SPAWN-GIT-HANG-THEIR-WHOLE-TIMEOUT-IN-LANES.md); investigate and close the two records together. Main's subsequent Git-fixture isolation change (`1bbe15e2`) changes the reproduction environment but does not by itself establish that this timeout is resolved.
- **Acceptance:** The test passes repeatedly within the complete verification lane under normal parallel load, and a deliberately blocked child step fails with a named cause before the suite-wide timeout.
- **Source:** Additive release QA tag correction on `feat/mvp-release-qa-plan`.
