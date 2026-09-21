#!/bin/zsh

# The SessionStart hook for Claude Code and Codex, rendered into .claude/settings.json and
# .codex/hooks.json from .rulesync/hooks.jsonc. It runs the repository's one setup entry,
# `./agent setup`, and then gives Claude Code's tool shell the pinned devenv profile: Claude Code
# sets CLAUDE_ENV_FILE to a file it sources before every Bash tool command, so one export here
# replaces an `export PATH=…` prefix on every command an agent runs — a prefix that also took the
# command out of its allow rule and into permission review. Codex sets no such file and gets
# setup alone. Hooks run outside the Bash sandbox, so the install setup performs is unrestricted.
emulate zsh
set -e

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h:h:h:h:h}"
PROFILE_BIN="$REPO_ROOT/.devenv/profile/bin"

"$REPO_ROOT/agent" setup

if [[ -n "${CLAUDE_ENV_FILE:-}" && -d "$PROFILE_BIN" ]]; then
  {
    echo '# Tao: the pinned devenv profile, written by .rulesync/hooks.jsonc via agent-session-start.zsh'
    printf 'case ":$PATH:" in *":%s:"*) ;; *) export PATH="%s:$PATH" ;; esac\n' "$PROFILE_BIN" "$PROFILE_BIN"
  } >> "$CLAUDE_ENV_FILE"
fi
