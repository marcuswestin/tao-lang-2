#!/bin/sh

# The UserPromptSubmit hook for Claude Code and Codex, rendered from .rulesync/hooks.jsonc. Only a
# Claude Code cloud session does anything: CloudPromptTitleEntry.ts prefixes a custom title that
# arrived after SessionStart with `CLOUD: `. Every other session returns at once, because this runs
# before each prompt. It never blocks a prompt; a failure prints nothing.

[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../../../.." && pwd -P)
BUN="$REPO_ROOT/.devenv/profile/bin/bun"

[ -x "$BUN" ] || exit 0
"$BUN" run "$REPO_ROOT/packages/cli/agent-cli/agent-cli-src/agent-hooks/CloudPromptTitleEntry.ts" 2>/dev/null || true
