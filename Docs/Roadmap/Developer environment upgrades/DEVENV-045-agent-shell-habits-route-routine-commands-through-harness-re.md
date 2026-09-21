# DEVENV-045 — Agent shell habits route routine commands through harness review

- **Status:** In progress
- **Section:** External
- **Area:** Agent harness performance
- **Impact:** In Claude Code auto mode, every Bash call outside a narrow allow rule or the built-in
  read-only set waits about two seconds for the permission classifier; in Codex, every escalated action
  waits about three seconds for the auto-review model. The commands paying this are mostly routine.
- **Evidence:** 114 Claude Code sessions in this repository, 17,461 Bash calls: 10,266 begin with `cd`
  and 550 with `export PATH=…`; `export PATH… && <read-only command>` median 2.5s against 0.0–0.1s for
  the same command bare; `cat > file <<EOF` median 2.2s, `python3 -` heredocs 2.1s, `mkdir`/`cp`/`rm`
  1.9s, while `Edit` tool calls are approved instantly; 117 tool results were sandbox denials
  (`direnv exec .`, `bun install`). Codex: 962 auto-review turns, median 2.9s, 95% approved, dominated
  by `apply_patch` and `request_permissions`; 91 sandbox denials.
- **Workaround:** Agents already prefer `rg`, `ls`, and `git` forms that skip review. AGENTS.md tells
  sandboxed shells to prepend the profile bin themselves, which is what produces the `export PATH` prefix.
- **Proposed change:** Done on `feat/dev-speed-optimization-cbf7e5`: the SessionStart hook now runs
  `packages/dev/dev-src/cli/agent-session-start.zsh`, which runs `./agent setup` and, when Claude Code
  hands it `CLAUDE_ENV_FILE`, exports `.devenv/profile/bin` onto every later Bash tool command's PATH;
  `.rulesync/permissions.jsonc` sets `env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1` and allows
  `cd *`; AGENTS.md tells agents not to prefix `cd` or `export PATH` and to change files with the
  harness edit tool. The Codex patch reviews turned out to come from patches into a `/private/tmp`
  clone outside the workspace roots, so the `tao-workspace` profile is unchanged; work in the
  worktree instead.
- **Dependencies:** `.rulesync/permissions.jsonc`, `.rulesync/hooks.jsonc`, and `just _agent-config`
  own the generated settings. `CLAUDE_ENV_FILE` support is in Claude Code 2.1.220 (the installed CLI)
  and later.
- **Acceptance:** In new sessions the median duration of `cd`- or `export`-prefixed read-only commands
  equals the bare command's; a fresh worktree session shows no `direnv exec` sandbox denial.
- **Source:** 2026-09-04 development-speed review of Claude Code and Codex transcripts.
