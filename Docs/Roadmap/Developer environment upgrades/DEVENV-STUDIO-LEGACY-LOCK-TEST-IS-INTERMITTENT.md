# DEVENV-STUDIO-LEGACY-LOCK-TEST-IS-INTERMITTENT — Studio legacy-lock test is intermittent

- **Status:** Candidate
- **Section:** External
- **Area:** Studio device-trust test fixtures and verification
- **Impact:** A broad verification run can stop on the independent legacy-lock process proof, leaving unrelated checks unrun.
- **Evidence:** On 2026-10-02, `verify-changed/2026-10-02T22-33-23-016Z-80652-28a0c73d` failed the legacy directory-lock process case in `studio-device-trust-store.test.ts`; the guard reported a stopped legacy owner. The run drained and left 49 checks unrun, reporting load 103.6 on 18 CPUs. The complete isolated file then passed all 16 cases in `dev-test/2026-10-02T22-35-40-379Z-5268-9acd14d1`, also under load. This establishes intermittence, not its cause.
- **Workaround:** Let broad cleanup finish, rerun the full affected file with `./agent test-file packages/ides/studio/studio-tests/studio-device-trust-store.test.ts`, then repeat broad verification. A focused pass does not complete the aborted broad run.
- **Proposed change:** During the serial Studio test review, replace elapsed waiting with an attributable lock-observation handshake where the existing seams permit it. Inspect the release/removal/process-exit interleaving: an observation-to-liveness race is a hypothesis, not a confirmed root cause. Preserve the conservative legacy-owner guard and the real independent-process boundary.
- **Dependencies:** Serial Studio package review and independent review of any rewritten lifecycle proof.
- **Acceptance:** A deterministic proof establishes waiting before release, succeeds after release, cleans up both processes on failure, and fails an appropriate ordering mutation. Broad verification completes; production safety guards remain unchanged.
- **Source:** Serial test reduction follow-up on `feat/test-responsibility`, developer CLI changed gate, 2026-10-02.

The serial pass now replaces the 100 ms negative wait with a controlled blocked-poll signal. The independent owner remains alive after removing its lock until the new owner acknowledges opening; cleanup acknowledges both paths. This eliminates the fixture release-to-exit interleaving without changing production safeguards. Bypassing the legacy barrier fails this proof (`dev-test-mutation/2026-10-03T07-52-43-077Z-81193-d75a4fbd`); production was restored exactly and all 16 cases pass (`dev-test/2026-10-03T07-53-00-384Z-82751-1a3918f9`). Independent package review accepted the rewrite, and the complete Studio package passes 833 cases (`dev-test/2026-10-03T09-20-03-210Z-18814-e2ce8fc4`). Current broad verification remains required; the original intermittent failure cause is not conclusively established.
