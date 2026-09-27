#!/bin/zsh

# The SessionStart hook for Claude Code and Codex, rendered into .claude/settings.json and
# .codex/hooks.json from .rulesync/hooks.jsonc. It runs the repository's one setup entry,
# `./agent setup`, and then gives Claude Code's tool shell the pinned devenv profile: Claude Code
# sets CLAUDE_ENV_FILE to a file it sources before every Bash tool command, so one export here
# replaces an `export PATH=…` prefix on every command an agent runs — a prefix that also took the
# command out of its allow rule and into permission review. Codex sets no such file. Both
# harnesses get setup and a bounded, read-only model-routing audit. Hooks run outside the Bash
# sandbox, so the install setup performs is unrestricted.
# A fresh detached worktree emits a useful warning from ./agent, but it is not a hook failure.
# Show setup's output only when setup actually fails.
emulate zsh
set -e

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h:h:h:h:h}"
PROFILE_BIN="$REPO_ROOT/.devenv/profile/bin"

if setup_output="$(TAO_DEV_SHELL_SETUP=0 "$REPO_ROOT/agent" setup 2>&1)"; then
  :
else
  setup_status=$?
  print -r -- "$setup_output" >&2
  exit "$setup_status"
fi

if [[ -n "${CLAUDE_ENV_FILE:-}" && -d "$PROFILE_BIN" ]]; then
  {
    echo '# Tao: the pinned devenv profile, written by .rulesync/hooks.jsonc via agent-session-start.zsh'
    printf 'case ":$PATH:" in *":%s:"*) ;; *) export PATH="%s:$PATH" ;; esac\n' "$PROFILE_BIN" "$PROFILE_BIN"
  } >> "$CLAUDE_ENV_FILE"
fi

# Stdout reaches the agent's context in both harnesses, so the audit prints one line only when the
# routing table looks behind this machine. The same findings appear in ./agent doctor.
if [[ -x "$PROFILE_BIN/bun" ]]; then
  "$PROFILE_BIN/bun" run "$REPO_ROOT/packages/cli/agent-cli/agent-cli-src/cli/agent-model-audit.ts" "$REPO_ROOT" || true
fi
