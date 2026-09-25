#!/bin/bash
# Prove a release in a disposable vanilla macOS VM. The image cache may persist; the VM never does.
set -euo pipefail

image='ghcr.io/cirruslabs/macos-tahoe-vanilla:latest'
overall_started=$(date +%s)
name="tao-acceptance-$(date +%s)-$$"
root="$(pwd)/.artifacts/standalone-vm/$name"
input="$root/input"
logs="$root/logs"
release="$(pwd)/.artifacts/release/v0.0.0"
expect_script='packages/cli/tao-cli/cli-src/standalone-clean-machine.expect'
if [ -n "${TAO_STANDALONE_BUN:-}" ]; then
  bun_bin="$TAO_STANDALONE_BUN"
elif [ -x .devenv/profile/bin/bun ]; then
  bun_bin="$(pwd)/.devenv/profile/bin/bun"
else
  bun_bin=bun
fi
portable_bun_script='packages/cli/tao-cli/cli-src/standalone-bun.sh'
audit=0
case "${1:-}" in
  '') ;;
  --audit) audit=1 ;;
  *) printf 'Usage: %s [--audit]\n' "$0" >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then
  printf 'Usage: %s [--audit]\n' "$0" >&2
  exit 2
fi
created=0
started=0
vm_pid=''

mkdir -p "$input/release" "$logs/steps"

cleanup() {
  status=$?
  trap - EXIT
  if [ "$started" -eq 1 ]; then
    tart stop "$name" >> "$logs/cleanup.log" 2>&1 || true
    wait "$vm_pid" >> "$logs/cleanup.log" 2>&1 || true
  fi
  if [ "$created" -eq 1 ]; then
    if ! tart delete "$name" >> "$logs/cleanup.log" 2>&1; then
      printf 'Clean-machine: could not delete VM %s; see %s\n' "$name" "$logs/cleanup.log" >&2
      status=1
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
if ! command -v "$bun_bin" >/dev/null; then
  printf 'Bun is required to build the 0.0.0 release: %s\n' "$bun_bin" >&2
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

if [ "$audit" -eq 1 ]; then
  if ! step 'compile the filesystem auditor for the guest' "$portable_bun" build --compile \
    packages/cli/tao-cli/cli-src/standalone-filesystem-audit.ts --outfile "$input/filesystem-audit" \
    > "$logs/audit-compile.log" 2>&1; then
    cat "$logs/audit-compile.log" >&2
    exit 1
  fi
  cat "$logs/audit-compile.log"
fi

cat > "$input/run.sh" <<'GUEST'
#!/bin/sh
set -eu
cd /
export PATH=/usr/bin:/bin
export TAO_ACCEPTANCE_LOG_DIR='/Volumes/My Shared Files/tao-logs/steps'
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
auditor='/Volumes/My Shared Files/tao-input/filesystem-audit'
audit_logs='/Volumes/My Shared Files/tao-logs'
if [ -x "$auditor" ]; then
  "$auditor" snapshot /System/Volumes/Data "$audit_logs/filesystem-before.json"
  export TAO_ACCEPTANCE_AUDIT_FILESYSTEM=1
fi
if '/Volumes/My Shared Files/tao-input/acceptance' \
  '/Volumes/My Shared Files/tao-input/release/v0.0.0'; then
  acceptance_status=0
else
  acceptance_status=$?
fi
if [ -x "$auditor" ]; then
  "$auditor" snapshot /System/Volumes/Data "$audit_logs/filesystem-after.json"
  "$auditor" compare "$audit_logs/filesystem-before.json" "$audit_logs/filesystem-after.json" \
    "$audit_logs/filesystem-diff.json" "$audit_logs/filesystem-diff.txt"
fi
exit "$acceptance_status"
GUEST

created=1
if ! step 'clone vanilla macOS' tart clone "$image" "$name" 2>&1 | tee "$logs/clone.log"; then
  exit 1
fi
printf 'Clean-machine: booting %s headless...\n' "$name"
boot_started=$(date +%s)
tart run --no-graphics --dir="tao-input:$input:ro" --dir="tao-logs:$logs" "$name" > "$logs/boot.log" 2>&1 &
vm_pid=$!
started=1

address=''
deadline=$(($(date +%s) + 240))
last_wait_report=$boot_started
ready_streak=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if ! kill -0 "$vm_pid" 2>/dev/null; then
    printf 'Clean-machine: guest exited during boot; see %s\n' "$logs/boot.log" >&2
    exit 1
  fi
  address=$(tart ip "$name" 2>/dev/null || true)
  if [ -n "$address" ] && /usr/bin/expect "$expect_script" "$address" '/usr/bin/true' >> "$logs/ssh-ready.log" 2>&1; then
    ready_streak=$((ready_streak + 1))
    if [ "$ready_streak" -ge 2 ]; then
      break
    fi
  else
    ready_streak=0
  fi
  now=$(date +%s)
  if (( now - last_wait_report >= 15 )); then
    if [ -n "$address" ]; then
      printf 'Clean-machine: waiting for guest SSH at %s (%ss elapsed); see %s\n' \
        "$address" "$((now - boot_started))" "$logs/ssh-ready.log"
    else
      printf 'Clean-machine: waiting for guest IP (%ss elapsed)...\n' "$((now - boot_started))"
    fi
    last_wait_report=$now
  fi
  sleep 3
done
if [ "$ready_streak" -lt 2 ]; then
  printf 'Clean-machine: guest SSH did not become ready; see %s\n' "$logs" >&2
  if [ -f "$logs/ssh-ready.log" ]; then
    tail -n 4 "$logs/ssh-ready.log" >&2
  fi
  exit 1
fi
printf 'Clean-machine: guest SSH ready in %ss\n' "$(($(date +%s) - boot_started))"

printf 'Clean-machine: SSH password is supplied automatically; no input is needed.\n'
ssh_timeout=600
if [ "$audit" -eq 1 ]; then
  ssh_timeout=1800
fi
if ! step 'run standalone acceptance in the vanilla guest' \
  /usr/bin/expect "$expect_script" "$address" '/bin/sh "/Volumes/My Shared Files/tao-input/run.sh"' "$ssh_timeout" \
  2>&1 | tee "$logs/acceptance.log"; then
  exit 1
fi
