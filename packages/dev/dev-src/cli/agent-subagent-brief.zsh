#!/bin/zsh

# The SubagentStart hook for Claude Code and Codex, rendered into .claude/settings.json and
# .codex/hooks.json from .rulesync/hooks.jsonc. It gives every subagent the repository boilerplate
# that the `delegation` skill otherwise asks each caller to paste into each brief, so a brief
# carries only what is particular to its task.
#
# Both harnesses take non-blocking context the same way: a JSON object on stdout carrying
# `hookSpecificOutput.additionalContext`, delivered at the start of the subagent's conversation,
# before its first prompt. Neither event can block a subagent from starting, which is what makes
# this safe to run unconditionally.
#
# The text is written as statements about this worktree rather than as instructions. Injected
# context phrased as out-of-band commands can trip a harness's prompt-injection defences, which
# would surface it to the person instead of letting the agent act on it.
#
# Each function sets its own options, so sourcing this file for a test runs nothing.

# tao_subagent_brief prints the boilerplate. One line per rule, joined by the caller.
function tao_subagent_brief() {
  emulate -L zsh
  local -a lines
  lines=(
    'Commands here run from the worktree root, with paths relative to it; a `cd`, `export`, or `VAR=value` prefix takes a command out of its permission allow rule.'
    'Searches use `rg`, which skips the generated `_gen_*` trees, `.artifacts/`, `node_modules/`, and the linked worktrees that `grep -r` and `find` descend into.'
    'The Git index belongs to the caller: work here does not stage, unstage, commit, reset, stash, or switch branches.'
    'The developer-environment ledger under `Docs/Roadmap/Developer environment upgrades/` and its index are the caller'"'"'s to edit; findings about the developer environment go back in the report instead.'
    'Work products in this repository — file names, documents, code, comments, branch names, commit messages — name no agent identity, and carry no AI `Co-Authored-By` trailer or generated-with line.'
  )
  print -r -- "Tao worktree conventions, which bind this subagent as they bind its caller. ${(j: :)lines}"
}

# tao_json_string renders text as a JSON string. The text above is the repository's own, so the
# escapes it can actually contain are enough.
function tao_json_string() {
  emulate -L zsh
  local text="$1"
  text="${text//\\/\\\\}"
  text="${text//\"/\\\"}"
  text="${text//$'\n'/\\n}"
  print -r -- "\"$text\""
}

function tao_subagent_brief_main() {
  emulate -L zsh
  # The payload is read and discarded: the boilerplate is the same for every subagent, and a hook
  # that leaves stdin unread can hand the harness a broken pipe.
  cat > /dev/null 2>&1
  printf '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":%s}}\n' \
    "$(tao_json_string "$(tao_subagent_brief)")"
  return 0
}

if [[ "${ZSH_EVAL_CONTEXT:-}" == 'toplevel' ]]; then
  tao_subagent_brief_main
  exit 0
fi
