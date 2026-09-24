# DEVENV-DOCTOR-TEST-OBSERVES-CONCURRENT-ARTIFACT-CREATION — Doctor test observes concurrent artifact creation

- **Status:** Candidate
- **Section:** External
- **Area:** Repository doctor and full verification
- **Impact:** A full `./agent verify` can fail the read-only doctor test because another lane creates a top-level `.artifacts` directory during the test, even though doctor did not write it. This makes a clean checkout's verification result dependent on test scheduling.
- **Evidence:** On 2026-09-24, `./agent verify` failed only `repository doctor > reads this checkout without changing it` at `packages/cli/dev-cli/dev-cli-tests/repository-doctor.test.ts:417`. Its before/after list differed only by the newly created `.artifacts/user` directory. The same file passed immediately afterward under `./agent test-file packages/cli/dev-cli/dev-cli-tests/repository-doctor.test.ts` with that directory already present.
- **Workaround:** Run the focused file after the concurrent artifact creation has settled, then rerun the complete lane. Keep the original full-lane failure visible rather than calling the focused pass a complete pass.
- **Proposed change:** Make the doctor's no-write assertion observe only writes attributable to `readDoctorFacts`, or run it against an isolated artifact root. Preserve a test that catches actual doctor writes without comparing the shared top-level directory during parallel verification.
- **Dependencies:** None.
- **Acceptance:** Repeated full verification from a fresh artifact root passes while other lane nodes create their normal artifact directories, and a deliberate doctor write still fails the focused test.
- **Source:** Initial release QA plan verification on `feat/mvp-release-qa-plan`.
