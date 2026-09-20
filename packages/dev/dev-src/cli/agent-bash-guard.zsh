#!/bin/zsh

# The PreToolUse guard for Bash, rendered into .claude/settings.json and .codex/hooks.json from
# .rulesync/hooks.jsonc. `BashCommandGuard.ts` holds the rules and the reasons; this script exists
# only to reach it cheaply and to fail open.
#
# It runs before every Bash tool call, so it takes the pinned Bun directly rather than going through
# `./agent`, whose bootstrap checks dependencies and rebuilds the CLI — right for a command an agent
# typed, far too much for a hook on the path of every command. The guard module imports nothing, so
# the cost is one Bun start.
#
# Every failure path is silent and exits 0. A hook that blocks because it could not find its own
# interpreter would stop an agent working with no way to read why, and the rules it enforces are
# habits worth teaching rather than invariants worth halting on: the decision travels on stdout as
# JSON, which both harnesses read, and stderr is discarded so a Bun diagnostic can never be mistaken
# for one.
emulate zsh
set -u

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h:h:h:h}"
BUN="$REPO_ROOT/.devenv/profile/bin/bun"

[[ -x "$BUN" ]] || exit 0
"$BUN" "$SCRIPT_DIR/BashCommandGuard.ts" 2>/dev/null
exit 0
