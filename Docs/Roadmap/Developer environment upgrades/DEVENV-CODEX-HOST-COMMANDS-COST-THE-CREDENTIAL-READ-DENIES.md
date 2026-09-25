# DEVENV-CODEX-HOST-COMMANDS-COST-THE-CREDENTIAL-READ-DENIES — Codex host commands cost the credential read denies

- **Status:** Deferred
- **Section:** External
- **Area:** Permissions, native tools, landing
- **Impact:** Codex does not allow an execpolicy host bypass while its active profile denies any
  read. The generated `tao-workspace` profile therefore omits read denies so its listed
  `./agent unsandboxed` commands can run. The wrapper restricts which argv reaches the host, but
  each allowed command and its children can read the task's host credentials. Claude Code's
  matching exclusions have the same property. The instruction not to read credential paths is the
  remaining boundary for code run on the host.
- **Evidence:** On 2026-09-23, a Codex task with credential read denies ran a matching host rule
  sandboxed and could not reach CoreSimulatorService. A Full access task ran the same landing. The
  Codex source rejects the bypass when `has_denied_read_restrictions()` is true. The default profile
  now has no read denies, and the generated host rules cover only the wrapper prefixes in
  `.rulesync/permissions.jsonc`.
- **Workaround:** Keep the host prefix list narrow and review repository code it invokes. Do not
  treat the wrapper as a credential sandbox.
- **Proposed change:** Prove a separate host runner can deny credential paths while retaining
  CoreSimulator, Xcode, and CocoaPods access. Move credential-bearing operations such as push to
  fixed broker operations that run no editable repository code. Support streaming, cancellation,
  the pinned toolchain, and worktree validation before replacing the current wrapper.
- **Dependencies:** A host sandbox profile that can deny credential reads while native tools work.
- **Acceptance:** A default Codex task and Claude Code session can land and boot a simulator while
  credential reads fail inside both harnesses and every host-runner command.
- **Source:** 2026-09-23, first draft in `84637818`, adapted for the shared wrapper policy.
