# DEVENV-105 — A mutable native recipe was auto-approved outside the sandbox

- **Status:** Resolved
- **Area:** Sandbox
- **Impact:** An exact permission for `just native-module-check` was both auto-approved and excluded
  from the shell sandbox. Because `Justfile` is mutable repository content, changing that recipe
  would have allowed arbitrary commands to inherit the permanent host escape without review.
- **Evidence:** The 2026-09-20 cross-stream review found the exact command in both
  `permission.bash` and `claudecode.sandbox.excludedCommands`; the generated Codex rule therefore
  emitted an unconditional outside-sandbox prefix for a repository-owned entrypoint. This
  contradicted `CodexConfigGenerator`'s rule that mutable repository entrypoints remain sandboxed
  or reviewed and the environment-recovery skill's prohibition on auto-approved host escapes.
- **Workaround:** Run the native proof from an ordinary host shell, approve the host transition
  explicitly, or opt into the unsandboxed session profile.
- **Change made:** Removed the exact auto-approval and sandbox exclusion. The Maven domain required
  by CocoaPods remains in the canonical network allowlist, while the native recipe itself now stays
  sandboxed or requires explicit host review.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the rule; `./agent setup` regenerates the
  harness permissions.
- **Acceptance:** Generated harness configuration contains no auto-approved outside-sandbox rule for
  `just native-module-check`, while the command remains documented and runnable after explicit host
  authorization.
- **Source:** 2026-09-20 developer-environment impact sweep review.
- **Archived:** 2026-09-20
