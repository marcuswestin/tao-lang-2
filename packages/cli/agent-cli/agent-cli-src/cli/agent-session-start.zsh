#!/bin/sh

# The SessionStart hook for Claude Code and Codex, rendered into .claude/settings.json and
# .codex/hooks.json from .rulesync/hooks.jsonc. It runs the repository's one setup entry,
# `./agent setup`, and then gives Claude Code's tool shell the pinned devenv profile: Claude Code
# sets CLAUDE_ENV_FILE to a file it sources before every Bash tool command, so one export here
# replaces an `export PATH=…` prefix on every command an agent runs — a prefix that also took the
# command out of its allow rule and into permission review. Codex sets no such file. Both
# CLI harnesses get setup and a bounded, read-only model-routing audit. Hosted Codex uses its
# explicit environment setup and maintenance scripts; local generated hooks do not configure it.
# Every Claude Code cloud Linux session checks the locked tools through bootstrap before setup, and
# has its title prefixed with `CLOUD: ` so the app's session list tells cloud sessions apart.
# A fresh detached worktree emits a useful warning from ./agent, but it is not a hook failure.
# Show setup's output only when setup actually fails.
set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../../../.." && pwd -P)
PROFILE_BIN="$REPO_ROOT/.devenv/profile/bin"

# A cloud session's title step needs the harness payload; read it before setup can consume stdin.
hook_payload=''
if [ "${CLAUDE_CODE_REMOTE:-}" = true ] && [ ! -t 0 ]; then
  hook_payload=$(cat)
fi

setup_repository() {
  if [ "${CLAUDE_CODE_REMOTE:-}" = true ] && [ "$(uname -s)" = Linux ]; then
    TAO_DEV_SHELL_SETUP=0 "$REPO_ROOT/.config/bootstrap-tao-dev-env" --install-nix
  else
    TAO_DEV_SHELL_SETUP=0 "$REPO_ROOT/agent" setup
  fi
}

if setup_output="$(setup_repository 2>&1)"; then
  :
else
  setup_status=$?
  printf '%s\n' "$setup_output" >&2
  exit "$setup_status"
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -d "$PROFILE_BIN" ]; then
  # Quote the literal path before writing shell source, including spaces and apostrophes.
  quoted_profile=$(printf '%s' "$PROFILE_BIN" | sed "s/'/'\\\\''/g")
  {
    echo '# Tao: the pinned devenv profile, written by .rulesync/hooks.jsonc via agent-session-start.zsh'
    printf "case \":\$PATH:\" in *\":\"'%s'\":\"*) ;; *) export PATH='%s':\"\$PATH\" ;; esac\n" "$quoted_profile" "$quoted_profile"
  } >> "$CLAUDE_ENV_FILE"
fi

# Stdout reaches the agent's context in both harnesses, so the audit prints one line only when the
# routing table looks behind this machine. The same findings appear in ./agent doctor.
# A Claude Code cloud session also gets its title prefixed with `CLOUD: `; that answer must be JSON,
# so CloudSessionTitleEntry.ts reads the hook payload on stdin and folds the notice into it.
if [ -x "$PROFILE_BIN/bun" ]; then
  if [ "${CLAUDE_CODE_REMOTE:-}" = true ]; then
    notice=$("$PROFILE_BIN/bun" run "$REPO_ROOT/packages/cli/agent-cli/agent-cli-src/cli/agent-model-audit.ts" "$REPO_ROOT" < /dev/null || true)
    printf '%s' "$hook_payload" \
      | "$PROFILE_BIN/bun" run "$REPO_ROOT/packages/cli/agent-cli/agent-cli-src/agent-hooks/CloudSessionTitleEntry.ts" "$notice" \
      || { [ -z "$notice" ] || printf '%s\n' "$notice"; }
  else
    "$PROFILE_BIN/bun" run "$REPO_ROOT/packages/cli/agent-cli/agent-cli-src/cli/agent-model-audit.ts" "$REPO_ROOT" || true
  fi
fi
