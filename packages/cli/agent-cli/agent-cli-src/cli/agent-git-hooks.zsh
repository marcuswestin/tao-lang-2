#!/bin/sh

# Thin entry for the repository's warn-only Git hooks (`commit-msg`, `pre-commit`) and their
# installer (`install`). The logic lives in
# packages/cli/agent-cli/agent-cli-src/agent-hooks/GitHooksEntry.ts; this finds a `bun` to run it
# with and never fails the commit or setup step it runs beside, including when `bun` is missing.
# `.git/hooks/<event>` entries this installs call this script by the committing worktree's own
# path, so a worktree that lacks it is silent before this ever runs.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
bun="$repo_root/.devenv/profile/bin/bun"
[ -x "$bun" ] || bun="$(command -v bun 2>/dev/null)"
[ -n "$bun" ] || exit 0
"$bun" run "$repo_root/packages/cli/agent-cli/agent-cli-src/agent-hooks/GitHooksEntry.ts" "$@"
exit 0
