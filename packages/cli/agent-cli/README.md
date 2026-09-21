# Agent CLI

How agents run and are configured: the `./agent` entry (`agent-cli-src/agent-dev.ts`), the agent
lifecycle hooks that back `.rulesync/hooks.jsonc` (`agent-cli-src/agent-hooks/`), harness adapter
generation from `.rulesync/` (`agent-cli-src/agent-config/`), and the delegation log and report
(`agent-cli-src/delegation/`). The shims the hooks call are zsh scripts beside `./agent` itself,
under `agent-cli-src/cli/`.

`tao-dev-cli` may import from here — `dev.ts` registers `agent-config` and `delegation-report` by
lazy import, and its `repo-lint-entry.ts` injects `AgentConfigFreshness` and the delegation issue
source — but nothing here imports `tao-dev-cli`. `packages/cli/dev-cli/README.md` owns the shared
lanes, artifacts, and doctor machinery both packages sit beside.
