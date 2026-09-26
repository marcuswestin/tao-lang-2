#!/bin/bash
# Prove a release in a disposable macOS VM. Cache the base; retain a failed clone only for recovery.
set -euo pipefail

profile=vanilla
prepare_base=0
lease_owned=0
lease_root="$HOME/.tao/standalone-vm-lease"
overall_started=$(date +%s)
name="tao-acceptance-$(date +%s)-$$"
root="$(pwd)/.artifacts/standalone-vm/$name"
input="$root/input"
logs="$root/logs"
release="$(pwd)/.artifacts/release/v0.0.0"
vm_helper='packages/cli/tao-cli/cli-src/standalone-vm.ts'
bun_bin="${TAO_STANDALONE_BUN:-$(pwd)/.devenv/profile/bin/bun}"
portable_bun_script='packages/cli/tao-cli/cli-src/standalone-bun.sh'
browser_app="${TAO_STANDALONE_BROWSER_APP:-/Applications/Google Chrome.app}"
if [ "$#" -eq 2 ] && [ -z "$1$2" ]; then set --; fi
if [ "$#" -eq 2 ] && { [ "$1" = --base ] || [ "$1" = --prepare-base ]; }; then
  if [ "$2" != vanilla ] && [ "$2" != xcode ]; then
    printf 'Expected the vanilla or xcode VM profile.\n' >&2
    exit 2
  fi
  profile="$2"
  if [ "$1" = --prepare-base ]; then prepare_base=1; fi
  set --
fi
case "$profile" in
  vanilla) image='ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bfe1f076e27786c5d92b89187a05b1d109b5071eb2dcdf02d596e34640' ;;
  xcode) image='ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:71d9dc1d6c4614b7ecbb328753124912b43425fc8cf1c4085d7f352026df6601' ;;
esac
if [ "$#" -eq 2 ] && { [ "$1" = --diagnose ] || [ "$1" = --stop ] || [ "$1" = --collect ] || [ "$1" = --recover-lease ] || [ "$1" = --audit-results ]; }; then
  owned_name="$2"
  if [[ ! "$owned_name" =~ ^tao-acceptance-[0-9]+-[0-9]+$ ]] || [ ! -d "$(pwd)/.artifacts/standalone-vm/$owned_name/logs" ]; then
    printf 'Expected a VM run owned by this checkout.\n' >&2
    exit 2
  fi
  owned_root="$(pwd)/.artifacts/standalone-vm/$owned_name"
  if [ "$1" = --audit-results ]; then
    "$bun_bin" run packages/cli/tao-cli/cli-src/standalone-filesystem-audit.ts compare \
      "$owned_root/logs/filesystem-before.json" "$owned_root/logs/filesystem-after.json" \
      "$owned_root/logs/filesystem-policy-replay.json" "$owned_root/logs/filesystem-policy-replay.txt" \
      "$owned_root/logs/guest/steps/audit-scope.json"
    printf 'Saved snapshot policy replay only; no guest was run or base qualified.\n'
  elif [ "$1" = --diagnose ]; then
    "$bun_bin" run "$vm_helper" exec "$owned_name" 10000 /bin/ps -axo pid=,command= > "$owned_root/logs/guest-processes.log"
    "$bun_bin" run "$vm_helper" exec "$owned_name" 15000 /usr/bin/log show --last 10m --style compact \
      --predicate 'subsystem == "com.apple.TCC"' > "$owned_root/logs/guest-privacy.log"
    printf 'Guest diagnostics: %s/logs/guest-{processes,privacy}.log\n' "$owned_root"
  elif [ "$1" = --recover-lease ]; then
    "$bun_bin" run "$vm_helper" recover-lease "$owned_name" "$owned_root"
  elif [ "$1" = --collect ]; then
    if ! mkdir "$owned_root/run-active"; then
      printf 'The original runner still owns %s; wait for it to exit before collecting.\n' "$owned_name" >&2
      exit 1
    fi
    trap 'rmdir "$owned_root/run-active"' EXIT
    "$bun_bin" run "$vm_helper" collect "$owned_name" "$owned_root"
    printf 'Recovered evidence in %s/logs. The stopped VM is retained.\n' "$owned_root"
  else
    # The runner retains uncollected evidence on the stopped disk even if RPC is unavailable.
    tart stop "$owned_name"
  fi
  exit
fi
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --audit ]; }; then
  printf 'Usage: %s [--prepare-base|--base vanilla|xcode | --diagnose|--stop|--collect|--recover-lease|--audit-results <owned-vm>]\n' "$0" >&2
  exit 2
fi
created=0
started=0
booted=0
collected=0
vm_pid=''

mkdir -p "$input/release" "$logs/steps"
mkdir "$root/run-active"

cleanup() {
  status=$?
  trap - EXIT
  if [ "$started" -eq 1 ]; then
    tart stop "$name" >> "$logs/cleanup.log" 2>&1 || true
    wait "$vm_pid" >> "$logs/cleanup.log" 2>&1 || true
  fi
  if [ -f "$root/disk-attached" ]; then
    printf 'Clean-machine: retaining VM %s because its disk may still be mounted; see %s\n' "$name" "$root/disk-attached" >&2
    status=1
  elif [ "$booted" -eq 1 ] && [ "$collected" -ne 1 ]; then
    printf 'Clean-machine: retaining stopped VM %s because guest evidence was not collected.\n' "$name" >&2
    printf 'Recover its logs with: ./agent unsandboxed standalone-cli-clean-machine --collect %s\n' "$name" >&2
    status=1
  elif [ "$created" -eq 1 ]; then
    if ! tart delete "$name" >> "$logs/cleanup.log" 2>&1; then
      printf 'Clean-machine: could not delete VM %s; see %s\n' "$name" "$logs/cleanup.log" >&2
      status=1
    fi
  fi
  rm -f "$input/browser.tar"
  rmdir "$root/run-active"
  if [ "$lease_owned" -eq 1 ]; then
    if [ -f "$root/disk-attached" ] || { [ -n "$vm_pid" ] && kill -0 "$vm_pid" 2>/dev/null; }; then
      printf 'Clean-machine: retaining VM lease %s; inspect its owner and the VM before recovery.\n' "$lease_root" >&2
      status=1
    else
      rm -f "$lease_root/owner.txt"
      rmdir "$lease_root"
    fi
  fi
  printf 'Clean-machine: total %ss\n' "$(($(date +%s) - overall_started))"
  printf 'Clean-machine logs: %s\n' "$logs"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

step() {
  label=$1
  shift
  began=$(date +%s)
  printf 'Clean-machine: %s...\n' "$label"
  if "$@"; then
    printf 'Clean-machine: %s passed in %ss\n' "$label" "$(($(date +%s) - began))"
  else
    status=$?
    printf 'Clean-machine: %s failed after %ss (exit %s); see %s\n' "$label" "$(($(date +%s) - began))" "$status" "$logs" >&2
    return "$status"
  fi
}

if ! command -v tart >/dev/null; then
  printf 'Tart is required for the clean-machine gate.\n' >&2
  exit 1
fi
# A shared account-wide lease coordinates our worktrees. Ambiguous/stale owners require inspection;
# age alone is never evidence that a Tart child or mounted disk has stopped.
tart_store="${TART_HOME:-$HOME/.tart}"
mkdir -p "$tart_store"
export TART_HOME="$(cd "$tart_store" && pwd -P)"
mkdir -p "$(dirname "$lease_root")"
if ! mkdir "$lease_root" 2>/dev/null; then
  printf 'Another VM workflow owns %s. Owner:\n' "$lease_root" >&2
  cat "$lease_root/owner.txt" >&2 || true
  exit 1
fi
lease_owned=1
printf 'pid=%s\nstarted=%s\nrun=%s\nvm=%s\ntart_home=%s\n' "$$" "$(/bin/ps -p $$ -o lstart=)" "$root" "$name" "$TART_HOME" > "$lease_root/owner.txt"
"$bun_bin" run "$vm_helper" idle "$name" "$root"
printf 'Clean-machine: profile %s, pinned image %s\n' "$profile" "$image"
tart_version=$(tart --version)
IFS=. read -r tart_major tart_minor tart_patch <<< "$tart_version"
if (( tart_major < 2 || (tart_major == 2 && tart_minor < 32) || (tart_major == 2 && tart_minor == 32 && tart_patch < 1) )); then
  printf 'Tart 2.32.1 or newer is required for this guest-agent transport; found %s.\n' "$tart_version" >&2
  exit 1
fi
if ! command -v "$bun_bin" >/dev/null; then
  printf 'The checkout Bun is unavailable: %s. Run ./agent setup first.\n' "$bun_bin" >&2
  exit 1
fi
if [ ! -x "$browser_app/Contents/MacOS/Google Chrome" ]; then
  printf 'The VM browser test needs Google Chrome at %s or TAO_STANDALONE_BROWSER_APP.\n' "$browser_app" >&2
  exit 1
fi
version=$("$bun_bin" --version)
printf 'Clean-machine: using Bun %s from %s\n' "$version" "$bun_bin"
IFS=. read -r major minor patch <<< "$version"
if (( major < 1 || (major == 1 && minor < 4) || (major == 1 && minor == 4 && patch < 2) )); then
  printf 'Bun 1.4.2 or newer is required to compile a runnable macOS release; found %s.\n' "$version" >&2
  exit 1
fi

if ! step 'build the 0.0.0 release' "$bun_bin" run \
  packages/cli/tao-cli/cli-src/standalone-build.ts --release 0.0.0 \
  > "$logs/release.log" 2>&1; then
  cat "$logs/release.log" >&2
  exit 1
fi
cat "$logs/release.log"

cp -R "$release" "$input/release/"
portable_bun=$(bash "$portable_bun_script")
if ! step 'compile the existing acceptance for the guest' "$portable_bun" build --compile \
  packages/cli/tao-cli/cli-src/standalone-acceptance.ts --outfile "$input/acceptance" \
  > "$logs/compile.log" 2>&1; then
  cat "$logs/compile.log" >&2
  exit 1
fi
cat "$logs/compile.log"

if ! step 'compile the browser click driver for the guest' "$portable_bun" build --compile \
  packages/cli/tao-cli/cli-src/standalone-browser-click.ts --outfile "$input/browser-click" \
  > "$logs/browser-compile.log" 2>&1; then
  cat "$logs/browser-compile.log" >&2
  exit 1
fi
cat "$logs/browser-compile.log"

# Archive on the host: traversing Chrome's framework symlinks through VirtioFS can fail with ELOOP.
step 'archive the browser bundle for the guest' /usr/bin/tar --no-xattrs -cf "$input/browser.tar" -C "$browser_app" .

# The vanilla image deliberately has no agent or developer tools. Add only the pinned RPC fixture.
agent_version=0.10.0
agent_sha=303a50d452753e36776ce8775e243be580bb3fc3ec8efde154320c37fd65b1a7
agent_archive="$(pwd)/.artifacts/standalone-toolchain/tart-guest-agent-$agent_version.tar.gz"
if [ ! -f "$agent_archive" ] || [ "$(shasum -a 256 "$agent_archive" | cut -d ' ' -f 1)" != "$agent_sha" ]; then
  step 'download the pinned Tart guest agent' curl --fail --location --retry 3 --progress-bar \
    "https://github.com/cirruslabs/tart-guest-agent/releases/download/v$agent_version/tart-guest-agent-darwin-all.tar.gz" \
    --output "$root/guest-agent.tar.gz"
  if [ "$(shasum -a 256 "$root/guest-agent.tar.gz" | cut -d ' ' -f 1)" != "$agent_sha" ]; then
    printf 'Tart guest agent download did not match its pinned SHA-256.\n' >&2
    exit 1
  fi
  mv "$root/guest-agent.tar.gz" "$agent_archive"
fi
/usr/bin/tar -xzf "$agent_archive" -C "$input" tart-guest-agent

cat > "$input/run.sh" <<'GUEST'
#!/bin/sh
set -eu
cd /
export PATH=/usr/bin:/bin
export TAO_ACCEPTANCE_LOG_DIR='/Users/admin/tao-harness/logs/steps'
export TAO_ACCEPTANCE_BROWSER_DRIVER='/Users/admin/tao-harness/input/browser-click'
export TAO_STUDIO_CHROME_PATH="$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
profile="$1"
export TAO_ACCEPTANCE_VM_PROFILE="$profile"
{ /usr/bin/sw_vers; /usr/bin/uname -m; } > "$TAO_ACCEPTANCE_LOG_DIR/guest-platform.log"
test -x "$TAO_ACCEPTANCE_BROWSER_DRIVER" || { echo 'The browser click driver is missing.' >&2; exit 1; }
test -x "$TAO_STUDIO_CHROME_PATH" || { echo 'The guest browser is missing.' >&2; exit 1; }
if [ "$profile" = vanilla ]; then
for tool in brew bun node; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "The vanilla guest unexpectedly has $tool on PATH." >&2
    exit 1
  fi
done
for tool in /opt/homebrew/bin/brew /opt/homebrew/bin/node /opt/homebrew/bin/bun /usr/local/bin/brew /usr/local/bin/node; do
  if [ -e "$tool" ]; then
    echo "The vanilla guest unexpectedly has $tool installed." >&2
    exit 1
  fi
done
if [ -d /Library/Developer/CommandLineTools ] || [ -d /Applications/Xcode.app ]; then
  echo 'The vanilla guest unexpectedly has Xcode tools installed.' >&2
  exit 1
fi
else
  /usr/bin/xcodebuild -version > "$TAO_ACCEPTANCE_LOG_DIR/xcode-version.log"
  /usr/bin/xcrun simctl list runtimes --json > "$TAO_ACCEPTANCE_LOG_DIR/simulator-runtimes.json"
  /opt/homebrew/bin/brew --version > "$TAO_ACCEPTANCE_LOG_DIR/brew-version.log"
  /opt/homebrew/opt/node@24/bin/node --version > "$TAO_ACCEPTANCE_LOG_DIR/vendor-node-version.log"
fi
export TAO_ACCEPTANCE_AUDIT_FILESYSTEM=1
if '/Users/admin/tao-harness/input/acceptance' \
  '/Users/admin/tao-harness/input/release/v0.0.0'; then
  acceptance_status=0
else
  acceptance_status=$?
fi
exit "$acceptance_status"
GUEST

if [ "$prepare_base" -eq 1 ]; then
  step "cache the pinned $profile base" tart pull "$image" 2>&1 | tee "$logs/pull.log"
fi
created=1
if ! step "clone the $profile base" tart clone "$image" "$name" 2>&1 | tee "$logs/clone.log"; then
  exit 1
fi
printf '%s\n' "$image" > "$logs/source-image.txt"
printf '%s\n' "$profile" > "$logs/profile.txt"
tart get "$name" --format json > "$logs/vm-config.json"
step 'provision the stopped clone' "$bun_bin" run "$vm_helper" provision "$name" "$root" \
  2>&1 | tee "$logs/provision.log"
printf 'Clean-machine: booting %s headless...\n' "$name"
boot_started=$(date +%s)
"$bun_bin" run "$vm_helper" boot "$name" "$root" > "$logs/boot.log" 2>&1 &
vm_pid=$!
started=1
booted=1

deadline=$(($(date +%s) + 240))
last_wait_report=$boot_started
ready_streak=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if ! kill -0 "$vm_pid" 2>/dev/null; then
    printf 'Clean-machine: guest exited during boot; see %s\n' "$logs/boot.log" >&2
    exit 1
  fi
  if "$bun_bin" run "$vm_helper" exec "$name" 10000 /usr/bin/true >> "$logs/exec-ready.log" 2>&1; then
    ready_streak=$((ready_streak + 1))
    if [ "$ready_streak" -ge 2 ]; then
      break
    fi
  else
    ready_streak=0
  fi
  now=$(date +%s)
  if (( now - last_wait_report >= 15 )); then
    printf 'Clean-machine: waiting for tart exec (%ss elapsed); see %s\n' \
      "$((now - boot_started))" "$logs/exec-ready.log"
    last_wait_report=$now
  fi
  sleep 3
done
if [ "$ready_streak" -lt 2 ]; then
  printf 'Clean-machine: tart exec did not become ready; see %s\n' "$logs" >&2
  if [ -f "$logs/exec-ready.log" ]; then
    tail -n 4 "$logs/exec-ready.log" >&2
  fi
  exit 1
fi
printf 'Clean-machine: tart exec ready in %ss\n' "$(($(date +%s) - boot_started))"

acceptance_status=0
step "run standalone acceptance in the $profile guest" \
  "$bun_bin" run "$vm_helper" exec "$name" 1800000 /bin/sh /Users/admin/tao-harness/input/run.sh "$profile" \
  2>&1 | tee "$logs/acceptance.log" || acceptance_status=$?
step 'stop the VM before its final audit' tart stop "$name"
wait "$vm_pid" || true
started=0
step 'collect guest logs and audit the stopped disk' "$bun_bin" run "$vm_helper" collect "$name" "$root" \
  2>&1 | tee "$logs/collect.log"
collected=1
step 'enforce the filesystem audit' "$bun_bin" run packages/cli/tao-cli/cli-src/standalone-filesystem-audit.ts \
  compare "$logs/filesystem-before.json" "$logs/filesystem-after.json" \
  "$logs/filesystem-diff.json" "$logs/filesystem-diff.txt" "$logs/guest/steps/audit-scope.json"
if [ "$acceptance_status" -eq 0 ]; then
  "$bun_bin" run "$vm_helper" qualify "$name" "$root"
fi
exit "$acceptance_status"
