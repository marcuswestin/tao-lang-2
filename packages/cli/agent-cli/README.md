# Agent CLI

How agents run and are configured: the `./agent` entry (`agent-cli-src/agent-dev.ts`), the agent
lifecycle hooks that back `.rulesync/hooks.jsonc` (`agent-cli-src/agent-hooks/`), harness adapter
generation from `.rulesync/` (`agent-cli-src/agent-config/`), and the delegation log, report, and
model-routing audit (`agent-cli-src/delegation/`). The shims the hooks call are zsh scripts beside
`./agent` itself, under `agent-cli-src/cli/`.

`tao-dev-cli` may import from here — `dev.ts` registers `agent-config`, `delegation-report`, and
`model-audit` by lazy import, its doctor shows the audit's findings, and its `repo-lint-entry.ts`
injects `AgentConfigFreshness` and the delegation issue source — but nothing here imports
`tao-dev-cli`. `packages/cli/dev-cli/README.md` owns the shared lanes, artifacts, and doctor
machinery both packages sit beside.

## Portable Codex Git permissions

Tracked `.codex/config.toml` contains only portable policy. During `./agent setup`, the
`agent-config` command also installs machine-local Git grants in
`$CODEX_HOME/config.toml` (otherwise `~/.codex/config.toml`) when that home exists. It resolves
Git's absolute common directory and worktree directory, deduplicates them for a primary
checkout, and adds only those paths as `write` entries to `permissions.tao-workspace.filesystem`.
Other user settings and comments remain intact; conflicting entries fail setup. Machines without
a Codex home still generate identical tracked adapters without creating user configuration.
The installer refuses inline filesystem layouts and restrictive user `:workspace_roots` tables
when it cannot prove a safe merge; resolve those rules explicitly rather than bypassing the failure.

Codex [permission profiles](https://learn.chatgpt.com/docs/permissions) merge entries across
configuration layers; project entries take precedence for the same path. These local additions
apply when `tao-workspace` is active. They persist for previously configured checkouts; remove
an obsolete exact entry from the user config only after its checkout is no longer in use.
No neighboring directory or project `.codex`/`.agents` write access is added. Git objects,
refs, indexes and hooks inside the granted metadata directory are writable.

Run setup on the host before starting a fresh session in a new or relocated checkout. If a
sandbox blocks missing user grants, setup fails with the host-setup instruction. SessionStart
runs setup, but cannot expand permissions already loaded by that session; restart afterward.
The tracked profile remains available before hooks run, and freshness compares its complete text
without consulting or modifying the user config.

Codex protects [Git metadata inside writable roots](https://learn.chatgpt.com/docs/agent-approvals-security#protected-paths-in-writable-roots).
An ignored `.codex/git-common-dir` link is unsuitable: Codex 0.157.0 rejects symlinked writable
roots. Relative parent traversal is unsupported, and the documented path tokens include no Git
directory token. Disposable primary and linked checkouts must therefore prove the merged exact
grants with real sandboxed commits, including denial of neighboring and project-config writes.

On macOS, `./agent unsandboxed docker-desktop start` launches the installed Docker Desktop app
with `open -a Docker`. It accepts no additional arguments. Successful launch does not imply the
Docker engine is ready; use `./agent unsandboxed capabilities` to inspect readiness before starting
the local InstantDB stack.
