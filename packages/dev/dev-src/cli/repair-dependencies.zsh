#!/bin/zsh

# Replace a dependency tree that Bun cannot repair in place. This script deliberately depends
# only on zsh and ordinary host commands: it must still run when node_modules cannot load Tao's
# TypeScript developer CLI.

emulate -L zsh
setopt NO_UNSET PIPE_FAIL

function usage() {
  print -u2 -- 'Usage: repair-dependencies.zsh <repository-root> <bun-temp-root> <bun-cache-root>'
}

if (( $# != 3 )); then
  usage
  exit 2
fi

typeset -r repository_root="${1:A}"
typeset -r bun_temp_root="${2:A}"
typeset -r bun_cache_root="${3:A}"
typeset -r node_modules="$repository_root/node_modules"
typeset -r lock_root="$repository_root/.artifacts/locks"
typeset -r lock_file="$lock_root/dependency-repair.lock"
typeset -r backup_parent="${TAO_DEPENDENCY_REPAIR_BACKUP_PARENT:-/private/tmp}"
typeset -r bun_command="${TAO_DEPENDENCY_REPAIR_BUN:-bun}"
typeset -r just_command="${TAO_DEPENDENCY_REPAIR_JUST:-just}"

if [[ ! -d "$repository_root" || ! -f "$repository_root/bun.lock" || "$repository_root" == / ]]; then
  print -u2 -- "Refusing dependency repair outside a Tao repository: $repository_root"
  exit 2
fi

mkdir -p -- "$lock_root" || {
  print -u2 -- "Unable to create the dependency-repair lock directory: $lock_root"
  exit 1
}

if ! zmodload zsh/system 2>/dev/null; then
  print -u2 -- "Tao's dependency repair requires zsh/system flock support."
  exit 1
fi
if ! : >> "$lock_file"; then
  print -u2 -- "Unable to create the dependency-repair lock: $lock_file"
  exit 1
fi

integer lock_fd
zsystem flock -t 600 -f lock_fd "$lock_file"
typeset -r lock_status=$?
if (( lock_status != 0 )); then
  if (( lock_status == 2 )); then
    print -u2 -- "Timed out waiting for dependency repair in this checkout: $lock_file"
  else
    print -u2 -- "Unable to acquire the dependency-repair lock: $lock_file"
  fi
  exit 1
fi

# The health check belongs inside the lock. A second caller that waited for a successful repair
# observes the now-healthy tree and returns without moving it or invoking Bun again.
if "$just_command" --justfile "$repository_root/Justfile" _dependency-health >/dev/null 2>&1; then
  print -- 'Dependencies are healthy; no repair was needed.'
  exit 0
fi

mkdir -p -- "$bun_temp_root" "$bun_cache_root" "$backup_parent" || {
  print -u2 -- 'Unable to create dependency-repair scratch directories.'
  exit 1
}

typeset backup_root
backup_root="$(mktemp -d "$backup_parent/tao-dependency-repair.XXXXXXXX")" || {
  print -u2 -- "Unable to create a dependency backup under $backup_parent."
  exit 1
}
typeset -r original_backup="$backup_root/original-node_modules"
typeset -r partial_backup="$backup_root/partial-node_modules"
integer original_moved=0
integer repair_active=1
integer repair_succeeded=0
integer restoration_attempted=0

function restore_failed_repair() {
  (( restoration_attempted == 0 )) || return 0
  restoration_attempted=1

  if [[ -e "$node_modules" || -L "$node_modules" ]]; then
    if mv -- "$node_modules" "$partial_backup"; then
      print -u2 -- "Partial dependency tree retained at: $partial_backup"
    else
      print -u2 -- "Unable to move the partial dependency tree aside: $node_modules"
      print -u2 -- "Original dependency tree remains available at: $original_backup"
      return 1
    fi
  fi

  if (( original_moved )); then
    if mv -- "$original_backup" "$node_modules"; then
      print -u2 -- "Restored the original dependency tree after the failed repair."
    else
      print -u2 -- "Unable to restore the original dependency tree from: $original_backup"
      return 1
    fi
  else
    print -u2 -- 'No original dependency tree existed; node_modules remains absent.'
  fi
}

function finish_interrupted_repair() {
  typeset -r exit_code="$1"
  trap - EXIT INT TERM HUP
  restore_failed_repair
  print -u2 -- "Dependency repair was interrupted; artifacts retained at: $backup_root"
  exit "$exit_code"
}

function finish_repair_on_exit() {
  typeset -r exit_code="$1"
  if (( repair_active && ! repair_succeeded )); then
    restore_failed_repair
    print -u2 -- "Dependency repair failed; artifacts retained at: $backup_root"
  fi
  return "$exit_code"
}

trap 'finish_repair_on_exit $?' EXIT
trap 'finish_interrupted_repair 130' INT
trap 'finish_interrupted_repair 143' TERM
trap 'finish_interrupted_repair 129' HUP

# Move the directory as a single entry. Do not traverse it: a damaged package can contain names
# such as .env, .idea, or .gitmodules that a managed sandbox forbids tools from reading or deleting
# individually even though it permits an atomic rename of the enclosing tree.
if [[ -e "$node_modules" || -L "$node_modules" ]]; then
  if ! mv -- "$node_modules" "$original_backup"; then
    print -u2 -- "Unable to move the damaged dependency tree to: $original_backup"
    exit 1
  fi
  original_moved=1
fi

TMPDIR="$bun_temp_root/" "$bun_command" install \
  --cwd "$repository_root" \
  --frozen-lockfile \
  --cache-dir="$bun_cache_root"
typeset -r install_status=$?
if (( install_status != 0 )); then
  exit "$install_status"
fi

if ! "$just_command" --justfile "$repository_root/Justfile" _dependency-health; then
  print -u2 -- 'The clean frozen install completed, but the dependency health check still fails.'
  exit 1
fi

repair_succeeded=1
repair_active=0
trap - EXIT INT TERM HUP
if (( original_moved )); then
  print -- "Dependency repair succeeded. Original dependency tree retained at: $original_backup"
else
  print -- "Dependency repair succeeded. Repair artifact retained at: $backup_root"
fi
