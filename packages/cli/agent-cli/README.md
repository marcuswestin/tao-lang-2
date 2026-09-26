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

On macOS, `./agent unsandboxed docker-desktop start` launches the installed Docker Desktop app
with `open -a Docker`. It accepts no additional arguments. Successful launch does not imply the
Docker engine is ready; use `./agent unsandboxed capabilities` to inspect readiness before starting
the local InstantDB stack.
