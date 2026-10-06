# DEVENV-LOCAL-HOST-TESTS-FAIL-PORT-ZERO — Local host tests fail while binding port zero

- **Status:** Candidate
- **Section:** External
- **Area:** Managed verification, local server startup and diagnostics
- **Impact:** Ordinary source verification stops before completing unrelated suites when a local host test cannot bind an ephemeral port. The error suggests that port zero is occupied rather than establishing whether the environment permits listening.
- **Evidence:** On 2026-10-04, `feat/native-photos-files` based on `e33f2d5ab`, `./agent verify-changed` failed in `apps/expo-host#2` with `Failed to start server. Is port 0 in use?`, syscall `listen`, code `EADDRINUSE`, errno `0`. A focused `./agent test-file packages/apps/expo-host/expo-host-tests/desktop-agent-host.test.ts` reproduced the same eight failures. The call is `Bun.serve` at `desktop-agent-host.ts:195`; neither that implementation nor its tests changed in this task. `.rulesync/permissions.jsonc` sets `allowLocalBinding: true`. The effective execution boundary and root cause remain unconfirmed; no host comparison was run. Logs: `.artifacts/logs/agent/verify-changed/2026-10-05T03-02-13-972Z-35723.log` and `.artifacts/logs/agent/test-file/2026-10-05T03-05-48-374Z-68962.log` in that worktree. A separate new-source Jest transform regression found by the broad run was fixed; it is not evidence for this listen failure.
- **Workaround:** None verified. Focused non-network source tests pass, but do not replace the blocked host tests or complete verification.
- **Proposed change:** Compare the unchanged test through an authorized host lane and the managed lane; identify the effective bind boundary before changing policy or tests. Add a bounded local-bind capability diagnostic and distinguish policy refusal from real port contention if the comparison confirms that cause. Do not mask the failure or silently skip server behavior coverage.
- **Dependencies:** An authorized host comparison; permission-policy changes require their own named approval if needed.
- **Acceptance:** The same focused suite passes in its intended verification environment, or a genuine capability failure is reported before the suite with a tested remediation. Port-occupied coverage remains meaningful; ordinary verification cannot claim success while these tests are unrun.
- **Source:** Modern Photos and Files shared-runtime iteration and isolated repeat.

## Managed iteration reproduction — October 5, 2026

The integrated native bridge tree `7e964b4` reproduced this failure in
`verify-changed/2026-10-05T12-21-45-355Z-66104-0f0ecda6`: account-server recorded
38 `EADDRINUSE` reports from loopback port-zero startup, and Studio/dev-cli recorded
the same bind error alongside explicit home-cache `EPERM` refusals. This does not
establish an occupied fixed port or a native-inspection deadlock. Three independent
outdated fixture expectations were corrected separately; none changes the bind
policy, server coverage or timeout limits. The managed lane is not green. Compare
against the task's named host verification receipt before attributing remaining
failures to source code; no new host operation or permission expansion is included.

## Home-cache denial in a related managed lane — October 6, 2026

`feat/ci-partition-balance` at `ea315f97f`, integrated with main `5f383efc70`, stopped
its local `verify-changed` at `cli/tao-cli#2`: three Firebase creation cases could not
publish the lifecycle lock under `~/.tao/cache/test-runs` (`EPERM`, syscall `open`).
The named node log is
`.artifacts/logs/verify-changed/2026-10-06T06-00-07-766Z-97505-2e40d0a9/cli_tao-cli_2.log`.
This is a home-cache write refusal, not evidence of port contention or failed
Firebase behavior. The unchanged focused Firebase file passed all five cases in
38.5 seconds with the supported absolute `TAO_HOME` pointing inside the checkout
(`.artifacts/iteration-tao-home`); evidence is
`.artifacts/logs/dev-test/2026-10-06T06-07-51-940Z-14991-d6ac557a/summary.json`.
The same broad run also recorded direct port-zero `EADDRINUSE` failures in dev-cli.
Four child-exit assertions and one publication waiter failed downstream of
controller startup; bind denial is a source-supported explanation, but their
uncaptured child stderr does not independently establish it. The dev-cli log's
sole `EPERM` string is a passing test name, not another write-denial error.
The incomplete local lane does not replace hosted portable verification. No
permission expansion, host bypass or skipped assertion is part of this observation.
