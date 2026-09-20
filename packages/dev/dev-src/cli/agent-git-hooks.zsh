#!/bin/zsh

# The repository's warn-only Git hooks, and their installer.
#
# `commit-msg` reports an attribution trailer or an agent identity in a commit message;
# `pre-commit` reports a detached HEAD and a branch that is not `feat/<name>` or `dev/<name>`.
# Neither fails a commit. They say what the message or the branch will look like afterwards and
# let the commit happen, because a hook that can stop work an agent is midway through costs more
# than the mistake it prevents. Their output reaches whoever ran `git commit`, in that command's
# own output. Promoting one to blocking is Ro's decision.
#
# `install` writes an entry script per hook into the hooks directory this checkout's worktrees
# share. That directory is one directory for fifteen or more worktrees, most of them sitting on
# commits older than this file, so the entry script asks the committing worktree for its own copy
# of this script and exits silently when that worktree has none. Nothing here fires for a landing:
# `git commit-tree` is plumbing and runs no hook, which is what keeps the landing command's squash
# commit outside all of this.
#
# Each function sets its own options, so sourcing this file for a test runs nothing.

# The identities a work product must not name. This list is data for the checks below and the one
# place in the repository these words are written; every other file states the rule without them.
typeset -ga TAO_AGENT_IDENTITY_PATTERNS=(
  '*claude*'
  '*anthropic*'
  '*codex*'
  '*chatgpt*'
  '*copilot*'
  '*gemini*'
  '*gpt-[0-9]*'
)

# The line shapes an automated attribution takes, whichever vendor wrote it.
typeset -ga TAO_ATTRIBUTION_LINE_PATTERNS=(
  'co-authored-by:*'
  '*generated with*'
  '*🤖*'
)

typeset -g TAO_GIT_HOOK_MARKER='# tao-warn-only-git-hook'
typeset -g TAO_GIT_HOOK_SCRIPT='packages/dev/dev-src/cli/agent-git-hooks.zsh'
typeset -ga TAO_GIT_HOOK_EVENTS=(commit-msg pre-commit)

# tao_names_an_agent_identity reports whether text names one. A token holding a path separator, or
# starting with a dot, names a file rather than an identity: `.claude/settings.json` and
# `.codex/hooks.json` are ordinary subjects for a commit message here.
function tao_names_an_agent_identity() {
  emulate -L zsh -o extended_glob
  local -a words
  words=(${=1})
  local word pattern
  for word in "${words[@]}"; do
    [[ "$word" == (*/*|.*) ]] && continue
    word="${(L)word}"
    for pattern in "${TAO_AGENT_IDENTITY_PATTERNS[@]}"; do
      [[ "$word" == ${~pattern} ]] && return 0
    done
  done
  return 1
}

# tao_is_attribution_line reports whether a line is an automated attribution trailer or a
# generated-with line. A `Co-Authored-By:` naming a person is not one, which is why the identity
# check runs over the same line; the robot marker needs no second opinion.
function tao_is_attribution_line() {
  emulate -L zsh -o extended_glob
  local line="$1" lower="${(L)1}" pattern
  [[ "$line" == *🤖* ]] && return 0
  for pattern in "${TAO_ATTRIBUTION_LINE_PATTERNS[@]}"; do
    [[ "$lower" == ${~pattern} ]] || continue
    tao_names_an_agent_identity "$line" && return 0
  done
  return 1
}

# tao_commit_message_warnings fills `reply` with what the message will carry into history. The
# offending text is never echoed back: naming the rule is enough to find it, and repeating a
# trailer puts it somewhere else it does not belong.
function tao_commit_message_warnings() {
  emulate -L zsh
  local path="$1" line
  local -i attribution=0 identity=0
  local -a warnings
  warnings=()
  [[ -r "$path" ]] || { reply=(); return 0 }
  # The `|| [[ -n "$line" ]]` clause reads the last line of a message that ends without a newline,
  # which a `git commit -m` message does.
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Git's own commentary is stripped before the message is stored.
    [[ "$line" == '#'* ]] && continue
    if tao_is_attribution_line "$line"; then
      attribution=1
    elif tao_names_an_agent_identity "$line"; then
      identity=1
    fi
  done < "$path"
  (( attribution )) && warnings+=(
    'This commit message carries an automated attribution trailer. Commit messages in this repository carry no AI Co-Authored-By trailer and no generated-with line. The commit is not blocked; amend it to drop the trailer.'
  )
  (( identity )) && warnings+=(
    'This commit message names an agent identity. Work products here — commit messages included — name none. The commit is not blocked. A path or a harness product read as an identity is a false positive of this check.'
  )
  reply=("${warnings[@]}")
}

# tao_branch_warnings fills `reply` with what this worktree's HEAD will do to the commit.
function tao_branch_warnings() {
  emulate -L zsh -o extended_glob
  local worktree="$1" branch
  local -a warnings
  warnings=()
  if ! branch="$(git -C "$worktree" symbolic-ref --quiet --short HEAD 2>/dev/null)"; then
    warnings+=(
      'This worktree is on a detached HEAD, so a commit made here belongs to no branch. Name one first: git switch -c feat/<name>'
    )
  elif [[ "$branch" != (feat|dev)/?* ]]; then
    warnings+=(
      "Branch \`$branch\` is not a \`feat/<name>\` or \`dev/<name>\` branch. Work branches here take one of those two prefixes: git switch -c feat/<name>"
    )
  fi
  reply=("${warnings[@]}")
}

# tao_report_warnings writes each warning where the person or agent running `git commit` sees it.
function tao_report_warnings() {
  emulate -L zsh
  local warning
  for warning in "$@"; do
    print -r -- "warning: $warning" >&2
  done
}

# tao_git_hooks_dir prints the directory Git reads this worktree's hooks from, which linked
# worktrees share.
function tao_git_hooks_dir() {
  emulate -L zsh
  local worktree="$1" configured common
  configured="$(git -C "$worktree" config --get core.hooksPath 2>/dev/null)"
  if [[ -n "$configured" ]]; then
    [[ "$configured" == /* ]] && print -r -- "$configured" || print -r -- "$worktree/$configured"
    return 0
  fi
  common="$(git -C "$worktree" rev-parse --git-common-dir 2>/dev/null)" || return 1
  [[ "$common" == /* ]] || common="$worktree/$common"
  print -r -- "$common/hooks"
}

# tao_git_hook_entry prints the entry script for one hook event.
function tao_git_hook_entry() {
  emulate -L zsh
  local event="$1"
  print -r -- '#!/bin/zsh'
  print -r -- "$TAO_GIT_HOOK_MARKER $event"
  print -r -- '#'
  print -r -- '# Written by `./agent setup`. This directory is shared by every linked worktree of this'
  print -r -- '# checkout, and most of them sit on commits that have no copy of the script below, so the'
  print -r -- '# worktree that is committing is asked for its own. A worktree without one is left alone.'
  print -r -- '# It warns; it never fails a commit.'
  print -r -- 'emulate zsh'
  print -r -- 'worktree="$(git rev-parse --show-toplevel 2>/dev/null)"'
  print -r -- "script=\"\$worktree/$TAO_GIT_HOOK_SCRIPT\""
  print -r -- '[[ -n "$worktree" && -x "$script" ]] && "$script" '"$event"' "$@"'
  print -r -- 'exit 0'
}

# tao_is_repository_hook reports whether a hook file is one this repository wrote, by its marker.
function tao_is_repository_hook() {
  emulate -L zsh
  local head_lines
  head_lines="$(head -n 3 "$1" 2>/dev/null)"
  [[ "$head_lines" == *"$TAO_GIT_HOOK_MARKER"* ]]
}

# tao_install_git_hooks writes an entry script per event, leaving any hook this repository did not
# write in place. It fills `reply` with one line per event saying what it did.
function tao_install_git_hooks() {
  emulate -L zsh
  local hooks_dir="$1" event target
  local -a report
  report=()
  mkdir -p "$hooks_dir" 2>/dev/null || { reply=("Skipped Git hooks: $hooks_dir is not writable."); return 0 }
  for event in "${TAO_GIT_HOOK_EVENTS[@]}"; do
    target="$hooks_dir/$event"
    if [[ -e "$target" ]] && ! tao_is_repository_hook "$target"; then
      report+=("Left $event in place: it was not written by this repository.")
      continue
    fi
    if ! tao_git_hook_entry "$event" > "$target" 2>/dev/null; then
      report+=("Skipped $event: $target is not writable.")
      continue
    fi
    chmod 755 "$target" 2>/dev/null
    report+=("Installed $event.")
  done
  reply=("${report[@]}")
}

function tao_git_hooks_main() {
  emulate -L zsh
  local event="${1:-}" worktree
  worktree="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  case "$event" in
    (commit-msg)
      tao_commit_message_warnings "${2:-}"
      tao_report_warnings "${reply[@]}"
      ;;
    (pre-commit)
      tao_branch_warnings "$worktree"
      tao_report_warnings "${reply[@]}"
      ;;
    (install)
      local hooks_dir="${2:-$(tao_git_hooks_dir "$worktree")}"
      [[ -n "$hooks_dir" ]] || return 0
      tao_install_git_hooks "$hooks_dir"
      print -rl -- "${reply[@]}"
      ;;
  esac
  return 0
}

if [[ "${ZSH_EVAL_CONTEXT:-}" == 'toplevel' ]]; then
  tao_git_hooks_main "$@"
  exit 0
fi
