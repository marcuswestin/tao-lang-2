#!/bin/sh

# Thin entry for the PreToolUse Bash hook. The logic lives in
# packages/cli/agent-cli/agent-cli-src/agent-hooks/ShellHabitsEntry.ts; this finds a `bun` to run
# it with and never fails the tool call it runs beside, including when `bun` is missing.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
bun="$repo_root/.devenv/profile/bin/bun"
[ -x "$bun" ] || bun="$(command -v bun 2>/dev/null)"
[ -n "$bun" ] || exit 0
"$bun" run "$repo_root/packages/cli/agent-cli/agent-cli-src/agent-hooks/ShellHabitsEntry.ts"
exit 0
