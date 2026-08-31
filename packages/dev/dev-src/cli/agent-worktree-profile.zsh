# Report whether a checkout has a worktree-specific Git directory.
function tao_is_linked_worktree() {
  local worktree_dir="$1"
  local git_dir
  local common_git_dir
  git_dir="$(git -C "$worktree_dir" rev-parse --absolute-git-dir 2>/dev/null)" || return 2
  common_git_dir="$(git -C "$worktree_dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 2

  [[ "${git_dir:A}" != "${common_git_dir:A}" ]]
}

# Populate zsh's conventional reply array with Bun's checkout-specific install arguments.
function tao_bun_install_args() {
  local worktree_dir="$1"
  reply=(install)
  if tao_is_linked_worktree "$worktree_dir"; then
    # Clonefile installation cannot cross Codex's linked-worktree sandbox boundary.
    reply+=(--backend=copyfile)
  else
    local linked_status=$?
    (( linked_status == 1 )) || return "$linked_status"
  fi
  reply+=(--cwd "$worktree_dir")
}

# Run a command under a kernel-managed lock that is released with the owning subshell.
function tao_run_with_lock() {
  local lock_file="$1"
  local timeout_seconds="$2"
  shift 2

  if ! zmodload zsh/system 2>/dev/null; then
    echo "Tao's agent bootstrap requires zsh/system flock support." >&2
    return 1
  fi
  if ! : >> "$lock_file"; then
    echo "Unable to create agent bootstrap lock: $lock_file" >&2
    return 1
  fi

  (
    local lock_fd
    if zsystem flock -t "$timeout_seconds" -f lock_fd "$lock_file"; then
      "$@"
    else
      local lock_status=$?
      if (( lock_status == 2 )); then
        echo "Timed out waiting for agent bootstrap lock: $lock_file" >&2
      else
        echo "Unable to acquire agent bootstrap lock: $lock_file" >&2
      fi
      return 1
    fi
  )
}

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

# Bun normally requires the host's per-user temporary directory on macOS. Codex's
# managed sandbox grants ordinary workspace writes but Bun cannot use the host
# directory, so prefer the caller-owned artifact directory there.
function tao_bun_temp_dir() {
  local fallback_dir="$1"
  if [[ -n "${CODEX_SANDBOX:-}" && -d "$fallback_dir" && -w "$fallback_dir" ]]; then
    print -r -- "${fallback_dir:A}/"
    return
  fi

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
