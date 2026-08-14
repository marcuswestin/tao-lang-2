# Link a linked worktree to the primary checkout's already-built devenv profile.
function tao_link_primary_devenv_profile() {
  local worktree_dir="$1"
  local devenv_profile="$2"
  [[ -x "$devenv_profile/bin/node" ]] && return 0

  local common_git_dir
  common_git_dir="$(git -C "$worktree_dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  local primary_worktree_dir="${common_git_dir:h}"
  local primary_profile="$primary_worktree_dir/.devenv/profile"
  [[ "$primary_worktree_dir" != "$worktree_dir" ]] || return 1
  [[ -x "$primary_profile/bin/node" ]] || return 1
  if [[ -e "$devenv_profile" || -L "$devenv_profile" ]]; then
    [[ -x "$devenv_profile/bin/node" ]] && return 0
    return 1
  fi

  mkdir -p "${devenv_profile:h}"
  if ! ln -s "$primary_profile" "$devenv_profile" 2>/dev/null && [[ ! -x "$devenv_profile/bin/node" ]]; then
    return 1
  fi
  [[ -x "$devenv_profile/bin/node" ]] && return 0
  return 1
}

# Activate only a pinned devenv profile; callers own any explicit direnv trust fallback.
function tao_activate_devenv_profile() {
  local worktree_dir="$1"
  local devenv_profile="$2"
  tao_link_primary_devenv_profile "$worktree_dir" "$devenv_profile" || return 1
  export PATH="$devenv_profile/bin:$PATH"
}
