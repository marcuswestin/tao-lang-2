# DEVENV-PROFILE-LACKS-DIRENV-WHILE-DOCTOR-PASSES — Profile lacks direnv while doctor passes

- **Status:** Candidate
- **Section:** External
- **Area:** Shared development profile, linked worktrees, verification diagnostics
- **Impact:** Finalization fails in the real direnv activation test even though doctor reports the checkout usable.
- **Evidence:** On 2026-09-27, `feat/iphone-duo-acceptance` at `c21b2226eeba` ran `./agent unsandboxed finalize`. Verification failed in `packages/cli/dev-cli/dev-cli-tests/direnv-activation.test.ts:63` resolving `.devenv/profile/bin/direnv`, with `ENOENT`. The checkout profile links to the primary checkout's profile; direct inspection confirmed that the primary profile also lacks `bin/direnv`. `./agent doctor` then passed its profile check and reported the checkout usable. The finalization log is retained in the task checkout at `.artifacts/logs/agent/finalize/2026-09-27T06-06-22-861Z-89838.log`. This establishes missing profile content and a diagnostic gap, not whether the current pinned environment or an older materialized profile caused it.
- **Workaround:** None verified in this task; do not replace the shared profile while other worktrees may use it.
- **Proposed change:** Compare the materialized shared profile with the pinned environment in a separate environment-recovery slice. Restore the expected profile through the supported environment setup workflow if stale, and make doctor diagnose tools required by real environment tests.
- **Dependencies:** A supported environment setup session and coordination with users of the shared primary profile.
- **Acceptance:** Doctor names the missing required tool in an incomplete profile; the real direnv activation test and finalization succeed with the supported pinned profile.
- **Source:** iPhone Duo acceptance continuation, 2026-09-27, `feat/iphone-duo-acceptance`.
