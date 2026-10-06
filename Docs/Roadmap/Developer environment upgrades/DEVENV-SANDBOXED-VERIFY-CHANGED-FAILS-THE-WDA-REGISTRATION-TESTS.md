# DEVENV-SANDBOXED-VERIFY-CHANGED-FAILS-THE-WDA-REGISTRATION-TESTS — Sandboxed verify-changed fails the WDA registration tests

- **Status:** Candidate
- **Section:** External
- **Area:** Agent sandbox, `verify-changed`, Studio tooling `studio-mac2-test-isolation` tests.
- **Impact:** The iteration gate the merge-queue route starts from cannot pass inside the agent sandbox whenever the diff selects `ides/studio-tooling`; its definite failure then stops the lane before later suites (every tao-cli shard) run.
- **Evidence:** On 2026-10-06, `./agent verify-changed` in `feat/repo-transfer-urls` failed three `studio-mac2-test-isolation` cases with `EPERM: operation not permitted, mkdtemp '/private/tmp/tao-wda-…'`: `StudioWdaRegistration.ts:179` creates its socket directory under `/private/tmp`, which the sandbox does not let it write. The change touched none of that code. Log: `.artifacts/logs/verify-changed/2026-10-06T01-59-10-538Z-85306-ea40fd26/ides_studio-tooling.log`.
- **Workaround:** Read the log; when every failure is this EPERM, rely on hosted `Verify` and the host `./agent unsandboxed verify-full`.
- **Proposed change:** Let the tests inject the registration root (a directory under the worktree's `.artifacts/`), keeping `/private/tmp` only for the real native path, or have the gate report them as sandbox-skipped with the reason.
- **Dependencies:** None.
- **Acceptance:** `./agent verify-changed` from an agent shell passes or explicitly skips these cases, and the host lanes still run them.
- **Source:** First merge-queue landing, `feat/repo-transfer-urls`, 2026-10-06.
