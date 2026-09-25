# DEVENV-CODEX-HOST-COMMANDS-COST-THE-CREDENTIAL-READ-DENIES — Codex host commands cost the credential read denies

- **Status:** Deferred
- **Section:** External
- **Area:** Permissions, native tools, landing
- **Impact:** Codex does not allow an execpolicy host bypass while its active profile denies any
  read. The generated `tao-workspace` profile therefore omits read denies so
  `./agent unsandboxed` can run. The editable wrapper restricts which argv reaches the host, but
  each allowed command and its children can read the task's host credentials. Claude Code's
  matching exclusions have the same property. The instruction not to read credential paths is the
  remaining boundary for code run on the host.
- **Evidence:** On 2026-09-23, a Codex task with credential read denies ran a matching host rule
  sandboxed and could not reach CoreSimulatorService. A Full access task ran the same landing. The
  Codex source rejects the bypass when `has_denied_read_restrictions()` is true. The default profile
  now has no read denies. On 2026-09-25, the Developer chose one host permission per named
  `./agent unsandboxed X` operation, with deeper argv checked at dispatch. This does not protect
  against a changed wrapper or called implementation.
- **Workaround:** Require Developer approval before intentional changes to unsandboxed behavior;
  review those changes and the named argv list. Treat the wrapper as trusted repository code, not a
  credential or filesystem sandbox.
- **Proposed change:** Keep agents entirely sandboxed, including their ordinary `./agent` calls.
  Give them only a narrow protocol to a separately protected Tao host helper or daemon. The helper
  must validate fixed operations and arguments outside the editable checkout, constrain the work it
  launches, and deny credential reads where the operation does not require them. Prove streaming,
  cancellation, pinned-toolchain use, and worktree validation before replacing these host exceptions.
- **Dependencies:** A protected host helper design and a host sandbox profile that can deny
  credential reads while native tools work.
- **Acceptance:** A default Codex task and Claude Code session can land and boot a simulator while
  all agent shell commands remain sandboxed; only the protected helper performs approved host work,
  and credential reads fail in the agent shell and unrelated helper operations.
- **Source:** 2026-09-23, first draft in `84637818`, adapted for the shared wrapper policy.
