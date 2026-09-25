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
bun_bin="${TAO_STANDALONE_BUN:-bun}"
portable_bun_script='packages/cli/tao-cli/cli-src/standalone-bun.sh'
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
exec '/Volumes/My Shared Files/tao-input/acceptance' \
  '/Volumes/My Shared Files/tao-input/release/v0.0.0'
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
while [ "$(date +%s)" -lt "$deadline" ]; do
  if ! kill -0 "$vm_pid" 2>/dev/null; then
    printf 'Clean-machine: guest exited during boot; see %s\n' "$logs/boot.log" >&2
    exit 1
  fi
  address=$(tart ip "$name" 2>/dev/null || true)
  if [ -n "$address" ] && /usr/bin/expect "$expect_script" "$address" '/usr/bin/true' >> "$logs/ssh-ready.log" 2>&1; then
    break
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
if [ -z "$address" ] || ! /usr/bin/expect "$expect_script" "$address" '/usr/bin/true' >> "$logs/ssh-ready.log" 2>&1; then
  printf 'Clean-machine: guest SSH did not become ready; see %s\n' "$logs" >&2
  if [ -f "$logs/ssh-ready.log" ]; then
    tail -n 4 "$logs/ssh-ready.log" >&2
  fi
  exit 1
fi
printf 'Clean-machine: guest SSH ready in %ss\n' "$(($(date +%s) - boot_started))"

if ! step 'run standalone acceptance in the vanilla guest' \
  /usr/bin/expect "$expect_script" "$address" '/bin/sh "/Volumes/My Shared Files/tao-input/run.sh"' \
  2>&1 | tee "$logs/acceptance.log"; then
  exit 1
fi
