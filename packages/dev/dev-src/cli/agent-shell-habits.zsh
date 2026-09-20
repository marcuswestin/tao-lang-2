#!/bin/zsh

# The PreToolUse hook for the Bash tool in Claude Code and Codex, rendered into
# .claude/settings.json and .codex/hooks.json from .rulesync/hooks.jsonc. It reads the pending tool
# call on stdin and states, beside the tool result, the shell habits this repository's commands
# depend on. It warns and never blocks: the command runs either way.
#
# Both harnesses deliver non-blocking, model-visible text the same way — a JSON object on stdout
# carrying `hookSpecificOutput.additionalContext` and no `permissionDecision`, so nothing about
# permissions is touched. Both name the tool `Bash` and put its command at `tool_input.command`.
# Anything unexpected — no payload, no command, a shape neither harness documents — prints nothing
# and exits 0, because a hook on every shell command must cost nothing when it has nothing to say.
#
# The matching is deliberately cheap rather than a shell parser. It strips quoted spans first, so
# text inside a commit message or an `echo` is never read as a command, then looks only at the
# command word of each pipeline stage. What that misses it misses silently; a warning earns its
# place only while it is almost always about a real command.
#
# Each function sets its own options, so sourcing this file for a test changes nothing in the
# caller and defines every function below without running one.

# Repository commands whose exit status is a verdict. A pipe replaces that status with the
# filter's, which is the whole reason this one is worth saying.
typeset -ga TAO_REPOSITORY_COMMANDS=('./agent' 'just' './dev')
# The same, where the command word alone is too broad and a subcommand decides.
typeset -gA TAO_REPOSITORY_SUBCOMMANDS=(bun test bunx tsc)
# Filters that swallow the status of whatever is piped into them.
typeset -ga TAO_OUTPUT_FILTERS=(tail head rg grep less more sort uniq wc)
# Words that precede the real command word rather than being one.
typeset -ga TAO_COMMAND_PREFIXES=(sudo command time nice env exec xargs builtin noglob)

typeset -g TAO_SEARCH_WARNING="Recursive searches in this worktree use \`rg\`. \`grep -r\` and \`find\` descend the Git-ignored generated \`_gen_*\` trees, \`.artifacts/\`, \`node_modules/\`, and the linked worktrees, which \`rg\` skips; \`rg --hidden --glob '!.git/**'\` reaches tracked hidden configuration and \`--no-ignore\` reaches generated files."
typeset -g TAO_PREFIX_WARNING='A command beginning with `cd `, `export `, or a `VAR=value ` prefix falls outside its permission allow rule in this worktree and goes to permission review instead. Commands here run from the worktree root with paths relative to it.'
typeset -g TAO_PIPE_WARNING='A pipeline reports the exit status of its last stage, so a repository command piped into a filter reads as success when the command itself failed. Capturing first keeps the status: `cmd > out 2>&1; echo "EXIT=$?"`, then read the file.'

# tao_strip_quoted_spans removes double- then single-quoted spans, so quoted text is never read as
# a command. Double quotes go first: an apostrophe inside one would otherwise open a single-quoted
# span that runs to the end of the command.
function tao_strip_quoted_spans() {
  emulate -L zsh -o extended_glob
  local text="$1"
  text="${text//\"[^\"]#\"/ }"
  text="${text//\'[^\']#\'/ }"
  print -r -- "$text"
}

# tao_shell_statements splits a command into statements, one per element of `reply`. A command
# substitution becomes a statement of its own, because a gate judged through a pipe inside one is
# the same mistake with the same cost.
function tao_shell_statements() {
  emulate -L zsh
  local text="$1"
  local newline=$'\n'
  text="${text//\$\(/$newline}"
  text="${text//\`/$newline}"
  text="${text//'||'/$newline}"
  text="${text//'&&'/$newline}"
  text="${text//';'/$newline}"
  reply=("${(@f)text}")
}

# tao_command_word prints the command a pipeline stage runs, skipping grouping characters, leading
# assignments, and the wrappers that precede a command rather than being one.
function tao_command_word() {
  emulate -L zsh -o extended_glob
  local segment="${1##[[:space:]({!]##}"
  local -a words
  words=(${=segment})
  local word
  for word in "${words[@]}"; do
    [[ "$word" == [A-Za-z_][A-Za-z0-9_]#=* ]] && continue
    (( ${TAO_COMMAND_PREFIXES[(Ie)$word]} )) && continue
    print -r -- "$word"
    return 0
  done
  print -r -- ''
}

# tao_is_repository_command reports whether a stage runs a command whose exit status this
# repository reads as a verdict.
function tao_is_repository_command() {
  emulate -L zsh
  local stage="$1" word
  word="$(tao_command_word "$stage")"
  (( ${TAO_REPOSITORY_COMMANDS[(Ie)$word]} )) && return 0
  local subcommand="${TAO_REPOSITORY_SUBCOMMANDS[$word]:-}"
  [[ -n "$subcommand" && " $stage " == *" $subcommand "* ]]
}

# tao_searches_a_tree reports whether a stage walks a directory tree looking for something.
function tao_searches_a_tree() {
  emulate -L zsh -o extended_glob
  local stage="$1" word
  word="$(tao_command_word "$stage")"
  case "$word" in
    (grep) [[ "$stage" == *' -'[A-Za-z]#[rR]* || "$stage" == *' --recursive'* ]] ;;
    # `find` searches unless it is being used to remove what it finds.
    (find) [[ "$stage" != *' -delete'* ]] ;;
    (*) return 1 ;;
  esac
}

# tao_shell_habit_warnings fills `reply` with one warning per habit the command shows. An empty
# `reply` is the usual case and the only path whose cost matters.
function tao_shell_habit_warnings() {
  emulate -L zsh -o extended_glob
  local command="$1"
  local -a warnings statements stages
  warnings=()

  local first_word="${${=command}[1]:-}"
  if [[ "$first_word" == 'cd' || "$first_word" == 'export' || "$first_word" == [A-Za-z_][A-Za-z0-9_]#=* ]]; then
    warnings+=("$TAO_PREFIX_WARNING")
  fi

  local unquoted
  unquoted="$(tao_strip_quoted_spans "$command")"
  tao_shell_statements "$unquoted"
  statements=("${reply[@]}")

  local statement stage
  local -i searches=0 judges_a_pipe=0 status_is_read=0
  [[ "$unquoted" == (*pipefail*|*PIPESTATUS*|*pipestatus*) ]] && status_is_read=1

  for statement in "${statements[@]}"; do
    stages=("${(@s:|:)statement}")
    for stage in "${stages[@]}"; do
      tao_searches_a_tree "$stage" && searches=1
    done
    (( ${#stages} > 1 && ! status_is_read )) || continue
    tao_is_repository_command "${stages[1]}" || continue
    for stage in "${stages[@]:1}"; do
      (( ${TAO_OUTPUT_FILTERS[(Ie)$(tao_command_word "$stage")]} )) && judges_a_pipe=1
    done
  done

  (( searches )) && warnings+=("$TAO_SEARCH_WARNING")
  (( judges_a_pipe )) && warnings+=("$TAO_PIPE_WARNING")
  reply=("${warnings[@]}")
}

# tao_json_string renders text as a JSON string. The texts above are the repository's own, so the
# escapes a harness payload can actually carry are enough.
function tao_json_string() {
  emulate -L zsh
  local text="$1"
  text="${text//\\/\\\\}"
  text="${text//\"/\\\"}"
  text="${text//$'\n'/\\n}"
  text="${text//$'\t'/\\t}"
  text="${text//$'\r'/\\r}"
  print -r -- "\"$text\""
}

# tao_hook_command prints the Bash command a harness payload carries. Both harnesses put it at
# `tool_input.command`, and the value is the first JSON string under that key.
function tao_hook_command() {
  emulate -L zsh
  local payload="$1"
  [[ "$payload" =~ '"command"[[:space:]]*:[[:space:]]*"((\\.|[^"\\])*)"' ]] || return 1
  local text="${match[1]}"
  text="${text//\\n/$'\n'}"
  text="${text//\\t/$'\t'}"
  text="${text//\\r/$'\r'}"
  text="${text//\\\"/\"}"
  text="${text//\\\//\/}"
  text="${text//\\\\/\\}"
  print -r -- "$text"
}

# tao_shell_habits_report prints the harness JSON for a command, or nothing when the command shows
# no habit worth a line. The text is phrased as statements about this worktree rather than as
# instructions, which is what both harnesses ask of injected context.
function tao_shell_habits_report() {
  emulate -L zsh
  tao_shell_habit_warnings "$1"
  (( ${#reply} )) || return 0
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":%s}}\n' \
    "$(tao_json_string "Tao worktree shell habits. ${(j: :)reply}")"
}

function tao_shell_habits_main() {
  emulate -L zsh
  local payload command_text
  payload="$(cat 2>/dev/null)"
  [[ -n "$payload" ]] || return 0
  command_text="$(tao_hook_command "$payload")" || return 0
  tao_shell_habits_report "$command_text"
  return 0
}

if [[ "${ZSH_EVAL_CONTEXT:-}" == 'toplevel' ]]; then
  tao_shell_habits_main
  exit 0
fi
