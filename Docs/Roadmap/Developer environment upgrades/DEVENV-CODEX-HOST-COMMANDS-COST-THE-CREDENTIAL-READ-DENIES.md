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
- **Workaround:** Use only the named `./agent unsandboxed` operations from `agentHostCommands` and
  review repository code they invoke. The default Codex workspace profile has no credential read
  denies; the `AGENTS.md` instruction alone prevents agents from reading those paths.
- **Proposed change:** Keep `./agent unsandboxed` as the front end, but route it to a host runner: a
  LaunchAgent in the Developer's login session reached over an allowlisted Unix socket. Accept only
  allowlisted operations, verify that the requested directory is a worktree of this repository, and
  run each operation under its own `sandbox-exec` profile. These profiles must deny the credential
  paths while allowing CoreSimulator, Xcode, and devices. Keep credential use in fixed broker
  operations that run no repository code, such as push, release upload, and `gh` calls. Recreate the
  devenv `PATH` and caches for each command, stream output, and support cancellation of long-running
  commands such as `./tao dev` and Metro. Add Docker only as an opt-in entry.
  `feat/landing-agent-permissions` has prior art for a broker `land` operation with streaming and
  cancellation, but that broker runs the landing inside the credential-holding process; separate
  repository code execution from credential operations in this design.
- **Dependencies:** A host sandbox profile that can deny credential reads while native tools work.
- **Acceptance:** A default Codex task and Claude Code session can land and boot a simulator while
  credential reads fail inside both harnesses and every host-runner command.
- **Source:** 2026-09-23, first draft in `84637818`, adapted for the shared wrapper policy.
