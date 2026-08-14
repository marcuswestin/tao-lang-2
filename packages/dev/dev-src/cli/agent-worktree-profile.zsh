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

# Bun's installer requires the host's per-user temporary directory on macOS.
# A workspace-local TMPDIR is writable to the shell but Bun rejects it during
# package extraction. Fall back to a caller-owned directory on other hosts.
function tao_bun_temp_dir() {
  local fallback_dir="$1"
  local darwin_temp_dir
  darwin_temp_dir="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null)" || darwin_temp_dir=""
  if [[ -n "$darwin_temp_dir" && -d "$darwin_temp_dir" && -w "$darwin_temp_dir" ]]; then
    # Codex grants the physical /private/var path; macOS reports its /var symlink.
    # Bun 1.3 also requires TMPDIR's trailing separator for this physical path.
    print -r -- "${darwin_temp_dir:A}/"
    return
  fi

  if [[ -n "${TMPDIR:-}" && -d "$TMPDIR" && -w "$TMPDIR" ]]; then
    print -r -- "${TMPDIR:A}/"
    return
  fi

  print -r -- "${fallback_dir:A}/"
}
