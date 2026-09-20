#!/bin/zsh

# The one repository dependency installer. `./agent`, `./dev`, and Just recipes all call this
# implementation so they share one lock, one completion stamp, one health probe, and one recovery
# path. Agents use the public `./agent setup` command rather than invoking Bun directly.
emulate zsh
unsetopt BASH_REMATCH
set -e

TAO_DEPENDENCY_ROOT="${1:A}"
TAO_DEPENDENCY_MODE="${2:-}"
TAO_DEPENDENCY_DEV="$TAO_DEPENDENCY_ROOT/packages/dev"
TAO_DEPENDENCY_BUILD="$TAO_DEPENDENCY_ROOT/.artifacts/build/agent-dev"
TAO_DEPENDENCY_TEMP_ROOT="$TAO_DEPENDENCY_ROOT/.artifacts/tmp"
TAO_DEPENDENCY_CACHE_ROOT="$TAO_DEPENDENCY_ROOT/.artifacts/cache/bun"
TAO_DEPENDENCY_STAMP="$TAO_DEPENDENCY_BUILD/dev-deps.stamp"
TAO_DEPENDENCY_LOCK="$TAO_DEPENDENCY_BUILD/dev-deps.lock"
TAO_DEPENDENCY_HEALTH="$TAO_DEPENDENCY_DEV/dev-src/doctor/DependencyHealth.ts"
TAO_DEPENDENCY_REPAIR="$TAO_DEPENDENCY_DEV/dev-src/cli/repair-dependencies.zsh"
TAO_DEPENDENCY_PROFILE="$TAO_DEPENDENCY_ROOT/.devenv/profile"
TAO_DEPENDENCY_ATTEMPTS=3
TAO_DEPENDENCY_INSTALL_OUTPUT=""

source "$TAO_DEPENDENCY_DEV/dev-src/cli/agent-worktree-profile.zsh"

if ! tao_activate_devenv_profile "$TAO_DEPENDENCY_ROOT" "$TAO_DEPENDENCY_PROFILE"; then
  echo "Tao's pinned devenv profile is unavailable." >&2
  echo "Create the worktree with Worktrunk, or run: direnv allow && direnv exec . ./agent setup" >&2
  exit 1
fi

mkdir -p "$TAO_DEPENDENCY_BUILD" "$TAO_DEPENDENCY_TEMP_ROOT"
TAO_DEPENDENCY_TEMP="$(tao_bun_temp_dir "$TAO_DEPENDENCY_TEMP_ROOT")"
typeset -a TAO_DEPENDENCY_INSTALL_ARGS
tao_bun_install_args "$TAO_DEPENDENCY_ROOT"
TAO_DEPENDENCY_INSTALL_ARGS=("${reply[@]}" --frozen-lockfile)

function tao_dependency_state() {
  if [[ ! -d "$TAO_DEPENDENCY_ROOT/node_modules" ]]; then
    reply=missing
    return
  fi
  if [[ ! -f "$TAO_DEPENDENCY_STAMP" ]]; then
    reply=unproven
    return
  fi
  if [[ "$TAO_DEPENDENCY_ROOT/package.json" -nt "$TAO_DEPENDENCY_STAMP" ||
    "$TAO_DEPENDENCY_ROOT/bun.lock" -nt "$TAO_DEPENDENCY_STAMP" ||
    "$TAO_DEPENDENCY_DEV/package.json" -nt "$TAO_DEPENDENCY_STAMP" ]]
  then
    reply=stale
    return
  fi
  reply=current
}

function tao_dependency_health() {
  TMPDIR="$TAO_DEPENDENCY_TEMP" bun run "$TAO_DEPENDENCY_HEALTH"
}

function tao_report_install_failure() {
  local install_output="$1"
  echo "Bun could not install dependencies in $TAO_DEPENDENCY_ROOT." >&2
  echo "Bun temporary directory: $TAO_DEPENDENCY_TEMP" >&2

  if [[ "$install_output" == *"unable to write files to tempdir"* ]]; then
    echo "Denied operation: writing Bun's install scratch." >&2
    echo "Recover with: just clean-scratch && direnv exec . ./agent setup" >&2
    return
  fi

  if [[ "$install_output" =~ 'PermissionDenied: ([a-z ]+) (.+)' ]]; then
    echo "Denied operation: ${match[1]} ${match[2]}" >&2
    echo "The host sandbox denies writes to that path itself, not to the temporary directory." >&2
    echo "Start an unsandboxed session with 'just session-unsandboxed', then run './agent setup'." >&2
    return
  fi

  if [[ "$install_output" == *EEXIST*"failed to link package"* ]]; then
    echo "Denied operation: replacing a package that is already linked." >&2
    echo "A sandboxed repair cannot replace a package containing protected paths." >&2
    echo "Start an unsandboxed session with 'just session-unsandboxed', then run './agent setup'." >&2
    return
  fi

  echo "Recover with: just clean-scratch && direnv exec . ./agent setup" >&2
}

function tao_try_bun_install() {
  local install_output
  local attempt
  typeset -a extra_args
  extra_args=("$@")
  for (( attempt = 1; attempt <= TAO_DEPENDENCY_ATTEMPTS; attempt++ )); do
    if install_output="$(TMPDIR="$TAO_DEPENDENCY_TEMP" bun "${TAO_DEPENDENCY_INSTALL_ARGS[@]}" "${extra_args[@]}" 2>&1)"; then
      touch "$TAO_DEPENDENCY_STAMP"
      TAO_DEPENDENCY_INSTALL_OUTPUT=""
      return 0
    fi
    [[ "$install_output" == *"unable to write files to tempdir"* ]] || break
    tao_prune_bootstrap_scratch "$TAO_DEPENDENCY_TEMP_ROOT"
  done

  TAO_DEPENDENCY_INSTALL_OUTPUT="$install_output"
  return 1
}

function tao_run_bun_install() {
  tao_try_bun_install "$@" && return 0
  echo "$TAO_DEPENDENCY_INSTALL_OUTPUT" >&2
  tao_report_install_failure "$TAO_DEPENDENCY_INSTALL_OUTPUT"
  return 1
}

function tao_replace_dependency_tree() {
  if TAO_DEPENDENCY_REPAIR_FORCE=1 zsh "$TAO_DEPENDENCY_REPAIR" \
    "$TAO_DEPENDENCY_ROOT" "$TAO_DEPENDENCY_TEMP_ROOT/bun" "$TAO_DEPENDENCY_CACHE_ROOT"
  then
    touch "$TAO_DEPENDENCY_STAMP"
    return 0
  fi
  return 1
}

function tao_repair_dependencies() {
  local health_output
  if tao_try_bun_install && health_output="$(tao_dependency_health 2>&1)"; then
    return 0
  fi

  # Never force-relink packages in place. If a normal frozen install cannot make the graph healthy,
  # replace node_modules atomically so protected package paths cannot leave the old tree half-mutated.
  if tao_replace_dependency_tree; then
    return 0
  fi

  if [[ -n "$TAO_DEPENDENCY_INSTALL_OUTPUT" ]]; then
    echo "$TAO_DEPENDENCY_INSTALL_OUTPUT" >&2
    tao_report_install_failure "$TAO_DEPENDENCY_INSTALL_OUTPUT"
  else
    [[ -z "$health_output" ]] || echo "$health_output" >&2
    echo "The repository dependency probe still fails after dependency replacement." >&2
  fi
  return 1
}

function tao_ensure_dependencies_locked() {
  local state
  tao_dependency_state
  state="$reply"

  # A healthy tree installed by another entry point is proof enough. Adopting it creates the same
  # stamp instead of making Bun perform a redundant install over an already populated tree.
  if [[ "$state" == unproven ]] && tao_dependency_health >/dev/null 2>&1; then
    touch "$TAO_DEPENDENCY_STAMP"
    return 0
  fi

  if [[ "$state" != current ]]; then
    tao_repair_dependencies
    return
  fi

  [[ "$TAO_DEPENDENCY_MODE" == --health ]] || return 0
  tao_dependency_health >/dev/null 2>&1 && return 0
  tao_repair_dependencies
}

tao_run_with_lock "$TAO_DEPENDENCY_LOCK" 300 tao_ensure_dependencies_locked
