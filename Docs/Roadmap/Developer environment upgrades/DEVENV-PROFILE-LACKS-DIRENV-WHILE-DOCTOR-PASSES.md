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

## Independent continuation — 2026-09-27 UTC

`feat/iphone-duo-completion`, starting at `a66fd77290f8`, reproduced the missing executable with
`./agent test-file packages/cli/dev-cli/dev-cli-tests/direnv-activation.test.ts`. The real-direnv
case failed at line 63 with `ENOENT` for this checkout's `.devenv/profile/bin/direnv`; the merged
shell-preparation changes therefore did not remove this blocker. The current run is retained at
`.artifacts/logs/agent/test-file/2026-09-27T20-14-10-854Z-77269.log`.

The checkout's profile symlink still points to `/Users/ro/code/tao-lang-2/.devenv/profile`, resolving
to `/nix/store/zmv8vj2r56scg3cpw4na7xj2pnq75264-devenv-profile`. `devenv.nix` declares `pkgs.direnv`,
but that materialized profile lacks it. Doctor still passes the profile check using Node; its
initial separate missing-parser diagnostic was repaired with `./agent parser-gen`. Host capability
inspection also reports Hutch missing from PATH. These observations do not establish that every
host workflow fails.

The supported rebuild is `./agent setup --environment`; ordinary setup accepts the existing
profile's Node and Bun. Another worktree was active, and no supported isolated-profile rebuild
option was established, so the task preserved the shared profile rather than risking its users.
Coordinate a regular-terminal environment rebuild, then rerun the real-direnv test and
finalization. The shared-profile lifecycle risk remains tracked separately in DEVENV-072.
