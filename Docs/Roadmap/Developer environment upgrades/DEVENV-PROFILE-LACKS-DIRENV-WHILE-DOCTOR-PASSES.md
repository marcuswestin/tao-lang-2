# DEVENV-PROFILE-LACKS-DIRENV-WHILE-DOCTOR-PASSES — Profile lacks direnv while doctor passes

- **Status:** Candidate
- **Section:** External
- **Area:** Shared development profile, linked worktrees, verification diagnostics
- **Impact:** Finalization fails in the real direnv activation test even though doctor reports the checkout usable.
- **Evidence:** On 2026-09-27, `feat/iphone-duo-acceptance` at `c21b2226eeba` ran `./agent unsandboxed finalize`. Verification failed in `packages/cli/dev-cli/dev-cli-tests/direnv-activation.test.ts:63` resolving `.devenv/profile/bin/direnv`, with `ENOENT`. The checkout profile links to the primary checkout's profile; direct inspection confirmed that the primary profile also lacks `bin/direnv`. `./agent doctor` then passed its profile check and reported the checkout usable. The finalization log is retained in the task checkout at `.artifacts/logs/agent/finalize/2026-09-27T06-06-22-861Z-89838.log`. This establishes missing profile content and a diagnostic gap, not whether the current pinned environment or an older materialized profile caused it.
- **Workaround:** The Developer reported completing the supported environment rebuild on September 27; the finish checkout now resolves direnv and Hutch. The missing-tool symptom is recovered. The separate real-direnv fixture now gives its initial file an older modification time, and the focused integration test passes; incomplete-profile diagnostic acceptance remains unresolved. Coordinate any future shared-profile replacement with its users.
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

## Recovery and remaining verification exception — 2026-09-27 UTC

The Developer reported running `./agent setup --environment` and the focused real-direnv test
in the completion checkout. That handoff records eight passing tests with none skipped at
21:08 UTC, in `.artifacts/logs/agent/test-file/2026-09-27T21-08-23-559Z-70837.log`.

The independent finish checkout at `b2be40fe3584` verified its own profile links directly to
`/nix/store/bsfdvyiwy7hy8f9y8f0mdq8x9361f96r-devenv-profile`, with executable links for
direnv 2.37.1 and Hutch 0.24.3. Its named host capability check found Hutch available.
No environment rebuild or shared-profile mutation was needed. Doctor passed, including the
parser and dependency checks. This resolves the missing executable in this checkout; it does
not prove doctor's incomplete-profile diagnostic or DEVENV-072's concurrent-rebuild acceptance.

The fresh focused run at 21:16 UTC instead failed the real-direnv integration case after the
test immediately rewrote its configuration. The expected second `direnv: loading` and
`direnv: export +TAO_TEST_ACTIVE` messages were absent; initial loading/export and unloading
were present. Seven tests passed and one failed, with no skip. The failure occurred at the
stderr assertion before the changed-export stdout assertion, so the changed environment value
was not independently verified. The log is
`.artifacts/logs/agent/test-file/2026-09-27T21-16-52-146Z-74783.log` in the finish checkout.

The test performs both activations without explicitly waiting for a timestamp transition; the shell hook authorizes
changed content by hash and invokes direnv's own export hook. A same-second watch timestamp
collision is a hypothesis, not an established cause or a proven flake. Investigate using an
isolated real-direnv probe before changing production reload behavior or the fixture. No test
expectation was weakened. The subsequent per-commit run at 21:20 UTC passed this real-direnv
case and the selected lane, with evidence at
`.artifacts/logs/verify-changed/2026-09-27T21-20-23-892Z-77602-41cc827a/cli_dev-cli.log`.
That differing result does not explain the earlier failure or establish reliable reload behavior.
The historical full-run timeout exceptions and broad readiness remain outstanding, separately
from Device Hub's application-access denial.

## Deterministic real-direnv fixture — 2026-09-27 UTC

The 22:17 UTC selected lane and a subsequent focused run reproduced the absent second
loading/export messages. The focused runner tolerated its failure based on earlier outcome
reversals; its successful wrapper exit was not a passing raw test. The independent
[timestamp-watch investigation](Archive/DEVENV-DIRENV-RELOAD-TEST-SHARES-FILE-TIMESTAMPS.md)
then reproduced the cause with controlled equal and distinct timestamps and corrected the
fixture without weakening its assertions. The remaining issue here is doctor's failure to
diagnose an incomplete shared profile; the timestamp-watch defect has been resolved separately.
