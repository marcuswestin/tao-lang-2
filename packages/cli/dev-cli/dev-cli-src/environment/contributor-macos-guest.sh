#!/bin/sh
# Internal guest entry; contributor-macos-test.sh runs it in a fresh macOS VM that holds a clone of
# the committed source. It runs the commands CONTRIBUTING.md gives a new contributor, in its order,
# and nothing else, so a failure here is a defect in the documented path.
set -eu

case "${1:-}" in vanilla|xcode) profile=$1 ;; *) exit 2 ;; esac
[ "$#" -eq 1 ] || exit 2
cd "$(dirname "$0")/../../../../.."
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
user=$(/usr/bin/id -un)
logs="$PWD/.artifacts/contributor-macos"
mkdir -p "$logs"

finish() {
  result=$?
  trap - EXIT
  du -sk "$PWD" /nix "$HOME" > "$logs/disk-kib.txt" 2>&1 || true
  df -Pk "$PWD" > "$logs/filesystem-kib.txt" 2>&1 || true
  [ ! -d .artifacts/contributor-journey ] || cp -R .artifacts/contributor-journey "$logs/journey"
  [ ! -d .artifacts/logs ] || cp -R .artifacts/logs "$logs/workflow-logs"
  printf 'Host-only native and UI lanes were not run.\n' > "$logs/unrun.txt"
  exit "$result"
}
trap finish EXIT

# A step whose log stays the same size for 20 minutes is stopped: no documented step is that quiet,
# and the VM died after 100 silent minutes in the Nix install on 2026-10-07. Before stopping it,
# the processes and the disk, keychain and privacy daemons' recent log say what it was waiting on.
watch_step() {
  size=-1
  quiet=0
  while sleep 60 > /dev/null 2>&1; do
    current=$(wc -c < "$logs/$1.log" | tr -d ' ')
    if [ "$current" = "$size" ]; then quiet=$((quiet + 1)); else quiet=0; size=$current; fi
    printf 'Contributor macOS: %s running (%ss): %s\n' "$1" "$(($(date +%s) - started))" \
      "$(tail -n 1 "$logs/$1.log" | cut -c1-160)"
    if [ "$quiet" -ge 20 ]; then
      printf 'Contributor macOS: %s wrote nothing for 20 minutes; stopping it.\n' "$1"
      ps -axo pid,ppid,stat,etime,command > "$logs/$1.stalled-processes.txt" 2>&1 || true
      /usr/bin/log show --last 25m --style compact \
        --predicate 'process IN {"tccd","diskmanagementd","diskarbitrationd","securityd","diskutil","security"}' \
        2>&1 | tail -n 3000 > "$logs/$1.stalled-system-log.txt" || true
      kill "$2" 2>/dev/null || true
      return 0
    fi
  done
}

# One timed step per documented action. Output goes to its log; the console gets a line when the
# step starts and ends, and each minute its latest log line, so a stall shows where it stopped.
step() {
  label=$1
  shift
  started=$(date +%s)
  printf 'Contributor macOS: %s started; log: %s/%s.log\n' "$label" "$logs" "$label"
  env -i HOME="$HOME" USER="$user" TERM=dumb PATH="$PATH" "$@" > "$logs/$label.log" 2>&1 &
  step_pid=$!
  watch_step "$label" "$step_pid" &
  watch_pid=$!
  step_result=0
  wait "$step_pid" || step_result=$?
  kill "$watch_pid" 2>/dev/null || true
  wait "$watch_pid" 2>/dev/null || true
  printf '%s\t%s\t%s\n' "$label" "$step_result" "$(($(date +%s) - started))" >> "$logs/steps.tsv"
  printf 'Contributor macOS: %s finished (exit %s, %ss)\n' "$label" "$step_result" "$(($(date +%s) - started))"
  if [ "$step_result" -ne 0 ]; then
    tail -n 40 "$logs/$label.log"
  fi
  return "$step_result"
}

{ /usr/bin/sw_vers; /usr/bin/uname -m; } > "$logs/platform.txt"
printf '%s\n' "$profile" > "$logs/profile.txt"

if [ "$profile" = vanilla ]; then
  step clean-machine /bin/sh -eu -c '
    for tool in nix devenv brew bun node just; do
      if command -v "$tool"; then
        printf "Expected %s to be absent on a vanilla Mac.\n" "$tool" >&2
        exit 1
      fi
    done
    if [ -e /nix ] || /usr/bin/xcode-select -p; then
      printf "Expected no Nix store and no Xcode command line tools on a vanilla Mac.\n" >&2
      exit 1
    fi
    printf "vanilla: no Nix, devenv, Homebrew, Bun, Node, just, or Xcode command line tools\n"
  '
fi

# The commands below are the ones CONTRIBUTING.md documents; contributor-macos-test.test.ts holds
# each of them to the document. The installer's --no-confirm is its documented unattended form.
# Both installs are devenv's getting-started commands. The Determinate distribution always encrypts
# its store volume, and that step hung for 20 minutes in a headless guest on 2026-10-07; this one
# encrypts only under FileVault. nix-env needs no experimental features enabled.
step nix-install /bin/bash -o pipefail -c \
  "curl -sSfL https://artifacts.nixos.org/nix-installer | sh -s -- install --no-confirm"
# A new terminal reads these from the shell startup file the installer edits; a step has no terminal.
PATH="/nix/var/nix/profiles/default/bin:$HOME/.nix-profile/bin:/nix/var/nix/profiles/per-user/$user/profile/bin:$PATH"
step devenv-install nix-env --install --attr devenv -f https://github.com/NixOS/nixpkgs/tarball/nixpkgs-unstable
step tool-versions /bin/sh -eu -c 'nix --version; devenv version; command -v nix devenv'

result=0
if step setup ./enter-tao-dev-env --setup-only; then
  step test-focused ./dev test-file packages/language/parser/parser-tests/dialect.test.ts || result=1
  step test-package ./dev test-file packages/language/source-actions || result=1
  # The journey edits the compiler, so it runs after the tests that judge the committed tree.
  . "$PWD/packages/cli/dev-cli/dev-cli-src/environment/contributor-journey.sh"
  contributor_journey || result=1
else
  result=1
fi
exit "$result"
