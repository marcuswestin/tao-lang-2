# Populate zsh's conventional reply array with Bun's install arguments for a checkout.
#
# The backend is deliberately left to Bun. A linked worktree is an ordinary directory, not a
# filesystem boundary, so Bun's macOS default of `clonefile` installs there as it does in the
# primary checkout. Naming `--backend=copyfile` instead makes the install unrunnable under an
# agent sandbox: copyfile writes every packaged file through its own path, and several npm
# packages ship `.idea/` and `.gitmodules` files, which a sandbox protects inside the working
# directory and cannot be exempted from. Cloning writes whole directories in one operation and
# is not caught by that protection.
function tao_bun_install_args() {
  local worktree_dir="$1"
  reply=(install --cwd "$worktree_dir")
}

# Populate zsh's conventional reply array with the command and arguments `./agent` finally invokes,
# given its own raw argument list. `setup --refresh-lockfile` runs its own lockfile-refresh pass
# ahead of the ordinary `setup` command; any flags after `--refresh-lockfile` (`--json`, …) must
# still reach that command rather than being dropped on the floor.
function tao_agent_command_args() {
  if [[ "${1:-}" == setup && "${2:-}" == --refresh-lockfile ]]; then
    reply=(setup "${@:3}")
  else
    reply=("$@")
  fi
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
  local android_sdk="$devenv_profile/libexec/android-sdk"
  if [[ -d "$android_sdk" ]]; then
    export ANDROID_HOME="$android_sdk"
    export ANDROID_SDK_ROOT="$android_sdk"
    export ANDROID_USER_HOME="$worktree_dir/.android"
  fi
}

# Report whether an agent host is confining this process to an OS-level sandbox.
function tao_under_agent_sandbox() {
  [[ -n "${SANDBOX_RUNTIME:-}" || -n "${CODEX_SANDBOX:-}" || -n "${CLAUDE_CODE_TMPDIR:-}" ]]
}

# Report whether a temporary directory accepts the writes Bun's installer actually performs.
# A lone `mktemp` probe passes in sandboxes that still deny nested directory creation or the
# rename Bun publishes each extracted package with, so exercise all three.
function tao_temp_dir_accepts_files() {
  local temp_dir="$1"
  local probe_root
  [[ -d "$temp_dir" && -w "$temp_dir" ]] || return 1
  probe_root="$(mktemp -d "${temp_dir:A}/tao-bun-temp.XXXXXXXX" 2>/dev/null)" || return 1
  local probe_status=0
  {
    mkdir -p "$probe_root/staged/nested" &&
      print -r -- probe > "$probe_root/staged/nested/probe" &&
      mv "$probe_root/staged" "$probe_root/published"
  } 2>/dev/null || probe_status=1
  rm -rf "$probe_root" 2>/dev/null
  return "$probe_status"
}

# Choose Bun's temporary directory. Under an agent sandbox the worktree is the one location
# guaranteed writable, and its scratch is reclaimable with `just clean-scratch`, so prefer it
# over host temporary directories rather than discovering the denial mid-install.
function tao_bun_temp_dir() {
  local fallback_dir="$1"
  if tao_under_agent_sandbox && tao_temp_dir_accepts_files "$fallback_dir"; then
    print -r -- "${fallback_dir:A}/"
    return
  fi

  local darwin_temp_dir
  darwin_temp_dir="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null)" || darwin_temp_dir=""
  if [[ -n "$darwin_temp_dir" ]] && tao_temp_dir_accepts_files "$darwin_temp_dir"; then
    # Bun 1.3 requires TMPDIR's trailing separator for the physical macOS path.
    print -r -- "${darwin_temp_dir:A}/"
    return
  fi

  if [[ -n "${TMPDIR:-}" ]] && tao_temp_dir_accepts_files "$TMPDIR"; then
    print -r -- "${TMPDIR:A}/"
    return
  fi

  print -r -- "${fallback_dir:A}/"
}

# Remove bootstrap scratch left behind by a failed dependency install, which Bun's copyfile
# backend can leave gigabytes of. Only repository `.artifacts` scratch roots are ever emptied,
# and only their contents: a caller that names anything else is refused rather than obeyed.
function tao_prune_bootstrap_scratch() {
  # Sourced into whatever shell the caller already has, so its options are not inherited: the
  # `(DN)` qualifiers and `:A` below change meaning under a non-default option set.
  emulate -L zsh
  unsetopt BASH_REMATCH
  local scratch_dir="${1:A}"
  local report="${2:-}"
  case "$scratch_dir" in
  */.artifacts/tmp | */.artifacts/tmp/* | */.artifacts/cache | */.artifacts/cache/*) ;;
  *)
    echo "Refusing to prune bootstrap scratch outside a repository .artifacts root: $scratch_dir" >&2
    return 1
    ;;
  esac
  [[ -d "$scratch_dir" ]] || return 0

  local reclaimed_kb
  reclaimed_kb="$(du -sk "$scratch_dir" 2>/dev/null | cut -f1)"
  rm -rf -- "$scratch_dir"/*(DN) 2>/dev/null
  if [[ "$report" == "--report" ]]; then
    printf 'Reclaimed %s MB of bootstrap scratch from %s\n' "$(( ${reclaimed_kb:-0} / 1024 ))" "$scratch_dir"
  fi
}

# Warn once when a worktree is on a detached HEAD, where commits are unreachable by any branch.
# A warning only: the checkout is still usable, and stopping here would block read-only work.
function tao_warn_on_detached_head() {
  local worktree_dir="$1"
  git -C "$worktree_dir" rev-parse --verify --quiet HEAD >/dev/null 2>&1 || return 0
  git -C "$worktree_dir" symbolic-ref --quiet HEAD >/dev/null 2>&1 && return 0
  echo "This worktree is on a detached HEAD; commits made here belong to no branch." >&2
  echo "Name a branch before committing: ./agent start-branch feat/<name>" >&2
}
