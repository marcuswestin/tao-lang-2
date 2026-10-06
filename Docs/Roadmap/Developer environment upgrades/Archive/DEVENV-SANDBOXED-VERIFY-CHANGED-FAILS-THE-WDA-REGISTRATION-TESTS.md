# DEVENV-SANDBOXED-VERIFY-CHANGED-FAILS-THE-WDA-REGISTRATION-TESTS — Sandboxed verify-changed fails the WDA registration tests

- **Status:** Resolved
- **Area:** Agent sandbox, `verify-changed`, Studio tooling `studio-mac2-test-isolation` tests.
- **Impact:** The iteration gate the merge-queue route starts from cannot pass inside the agent sandbox whenever the diff selects `ides/studio-tooling`; its definite failure then stops the lane before later suites (every tao-cli shard) run.
- **Evidence:** On 2026-10-06, `./agent verify-changed` in `feat/repo-transfer-urls` failed three `studio-mac2-test-isolation` cases with `EPERM: operation not permitted, mkdtemp '/private/tmp/tao-wda-…'`: `StudioWdaRegistration.ts:179` creates its socket directory under `/private/tmp`, which the sandbox does not let it write. The change touched none of that code. Log: `.artifacts/logs/verify-changed/2026-10-06T01-59-10-538Z-85306-ea40fd26/ides_studio-tooling.log`. Reproduced on `feat/landing-route-tooling` the same day with `./agent test-file` (52 pass, 3 fail, same EPERM); after the fix the same command passed with 52 pass and 3 skip, printing the skip reason.
- **Workaround:** None required after the fix.
- **Proposed change:** Done as the skip variant: in an agent sandbox (`CLI.inAgentSandbox()`) the test file probes `mkdtemp` under `/private/tmp` once at load, and when `CLI.isSandboxDenial` recognises the refusal it registers the three registration-health cases as skipped and warns `Skipping the WDA registration health cases: the agent sandbox denies mkdtemp under /private/tmp, …`. Outside a sandbox the probe never runs, so a host that cannot write `/private/tmp` still fails them. `StudioWdaRegistration` keeps its `/private/tmp` path, which the runner entitlement requires.
- **Dependencies:** Settled on `feat/landing-route-tooling`.
- **Acceptance:** `./agent test-file packages/ides/studio-tooling/studio-tooling-tests/studio-mac2-test-isolation.test.ts` from an agent shell exits 0 with the three cases skipped and the reason in the suite log; the host lanes (`./agent unsandboxed verify-full`) still run them.
- **Source:** First merge-queue landing, `feat/repo-transfer-urls`, 2026-10-06.
- **Archived:** 2026-10-06
