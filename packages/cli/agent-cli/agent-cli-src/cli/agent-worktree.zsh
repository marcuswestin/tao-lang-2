#!/bin/bash

# Thin entry for the WorktreeCreate and WorktreeRemove hooks (`create` or `remove`). The logic lives
# in packages/cli/agent-cli/agent-cli-src/agent-hooks/WorktreePlacement.ts. Unlike the other hook
# entries this one must not exit quietly: the harness reads a create that prints no path as no
# worktree at all. Without a `bun`, as in a clone that has not run setup, it does what the harness
# would have done itself, so a session still gets its worktree.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 1
bun="$repo_root/.devenv/profile/bin/bun"
[[ -x "$bun" ]] || bun="$(command -v bun 2>/dev/null)"
if [[ -n "$bun" ]]; then
  exec "$bun" run "$repo_root/packages/cli/agent-cli/agent-cli-src/agent-hooks/WorktreeHookEntry.ts" "$@"
fi

payload="$(cat)"
primary="$(git rev-parse --path-format=absolute --git-common-dir)"
primary="${primary%/*}"
if [[ "$1" == create ]]; then
  name_pattern='"name" *: *"([A-Za-z0-9][A-Za-z0-9._-]*)"'
  [[ "$payload" =~ $name_pattern ]] || exit 1
  name="${BASH_REMATCH[1]}"
  target="$primary/.claude/worktrees/$name"
  if [[ ! -e "$target" ]]; then
    git -C "$primary" worktree add -b "worktree-$name" "$target" >&2 \
      || git -C "$primary" worktree add "$target" "worktree-$name" >&2 || exit 1
  fi
  printf '%s\n' "$target"
elif [[ "$1" == remove ]]; then
  path_pattern='"worktree_path" *: *"([^"]+)"'
  [[ "$payload" =~ $path_pattern ]] || exit 1
  target="${BASH_REMATCH[1]}"
  [[ -e "$target" ]] || exit 0
  git -C "$primary" worktree remove "$target" >&2
else
  exit 1
fi
