#!/bin/bash
# Fixed host operation. Proves the documented contributor path in a fresh Ubuntu Tart VM, as
# contributor-macos-test.sh does in a macOS one. It never accepts paths, VM names, or guest
# commands, and only the committed source (never the working tree or its credentials) enters the guest.
# Integration proof is hosted CI; this is the periodic local acceptance check and a debugging aid.
set -euo pipefail

mode=both
case "$#" in
  0) ;;
  2)
    if [ "$1" = --mode ] && { [ "$2" = cold ] || [ "$2" = cached ] || [ "$2" = both ]; }; then
      mode=$2
    else
      printf 'Expected --mode cold, cached, or both.\n' >&2
      exit 2
    fi ;;
  *) printf 'Usage: contributor-linux-test [--mode cold|cached|both]\n' >&2; exit 2 ;;
esac

# The repository is the one this script lives in, whatever the caller's directory.
repository=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd -P)
cd "$repository"
source packages/cli/tao-cli/cli-src/vm-guest-lib.sh
vm_label='Contributor Linux'
profile=ubuntu
vm_image_for_profile "$profile"

# The run directory doubles as the VM helper's run root: it holds the lease record and the input pushed
# into every guest. Each phase has its own VM, named after the run so the lease names its owner.
overall_started=$(date +%s)
run="$(date -u +%Y%m%dT%H%M%SZ)-$$"
stem="tao-contributor-$(date +%s)-$$"
name=$stem
root="$repository/.artifacts/contributor-linux/$run"
input="$root/input"
logs="$root/logs"
lease_root="$HOME/.tao/standalone-vm-lease"
vm_helper='packages/cli/tao-cli/cli-src/standalone-vm.ts'
bun_bin="${TAO_STANDALONE_BUN:-$repository/.devenv/profile/bin/bun}"
environment=packages/cli/dev-cli/dev-cli-src/environment
lease_owned=0
created=0
started=0
booted=0
collected=0
vm_pid=''
status=0
result=0

mkdir -p "$input" "$logs"
printf '%s\n' "$root" > "$repository/.artifacts/contributor-linux/latest.txt"
printf 'Contributor Linux evidence: %s\n' "$root"

# A clone is deleted once its guest evidence is on this host. A clone whose evidence was not
# collected is kept for inspection and named here.
cleanup() {
  status=$?
  trap - EXIT
  if [ "$started" -eq 1 ]; then
    tart stop "$running_vm" >> "$logs/cleanup.log" 2>&1 || true
    wait "$vm_pid" >> "$logs/cleanup.log" 2>&1 || true
  fi
  vm_cleanup_base_build
  rm -f "$root/harness.tar"
  if [ "$booted" -eq 1 ] && [ "$collected" -ne 1 ]; then
    printf 'Contributor Linux: retaining stopped VM %s because guest evidence was not collected; delete it with tart delete %s\n' "$name" "$name" >&2
    status=1
  elif [ "$created" -eq 1 ]; then
    if ! tart delete "$name" >> "$logs/cleanup.log" 2>&1; then
      printf 'Contributor Linux: could not delete VM %s; see %s\n' "$name" "$logs/cleanup.log" >&2
      status=1
    fi
  fi
  vm_release_lease
  printf 'exit_code=%s\nwall_seconds=%s\n' "$status" "$(($(date +%s) - overall_started))" >> "$root/result.txt"
  printf 'Contributor Linux: total %ss\n' "$(($(date +%s) - overall_started))"
  printf 'Contributor Linux exit %s; evidence: %s\n' "$status" "$root"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

vm_acquire_lease
printf 'Contributor Linux: mode %s, pinned image %s\n' "$mode" "$image"
vm_require_tart_version
vm_prepare_base
if ! command -v "$bun_bin" >/dev/null; then
  printf 'The checkout Bun is unavailable: %s. Run ./enter-tao-dev-env first.\n' "$bun_bin" >&2
  exit 1
fi

git rev-parse HEAD > "$root/source-commit.txt"
git status --porcelain > "$root/host-dirty-state.txt"
printf '%s\n' \
  'platform=linux/arm64 (Tart Ubuntu VM)' 'guest_cpus=4' 'guest_memory_mib=16384' 'guest_disk_gb=50' \
  'guest_timeout_seconds=7200' "image=$image" 'host_only_native_ui_lanes=unrun' \
  'source=git archive HEAD; uncommitted changes excluded' \
  'amd64=not covered locally; hosted Verify runs ubuntu-24.04 x86-64' > "$root/resources.txt"

# Hash exact tool inputs and the pinned image; never retain a dependency install or host profile.
{ git ls-tree HEAD .config/bootstrap-tao-dev-env devenv.lock "$environment"; printf 'image=%s\n' "$image"; } > "$root/cache-inputs"
cache_key=$(git hash-object "$root/cache-inputs")
rm "$root/cache-inputs"
cache_vm="tao-linux-tools-$cache_key"
printf 'owner=contributor-linux-test\nvm=%s\ncleanup=tart delete %s when no contributor run uses it\n' "$cache_vm" "$cache_vm" > "$root/cache-ownership.txt"

# Not a pipe: tar stops reading at its end marker, and a still-writing git archive would die of SIGPIPE.
make_source() {
  git archive --format=tar --output="$input/checkout.tar" HEAD
}
step 'archive the committed source for the guest' make_source

cat > "$input/run.sh" <<'GUEST'
#!/bin/sh
set -eu
export HOME=/home/admin
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
printf 'Guest account: %s; HOME=%s\n' "$(id)" "$HOME"
# The cached phase starts from a VM that already has these.
case "$1" in
  cold|tools)
    sudo DEBIAN_FRONTEND=noninteractive apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      curl ca-certificates xz-utils git tar coreutils util-linux ;;
esac
# The cached clone keeps the tools phase's checkout. Keep only its installed tools and artifacts, so a
# file the new commit deleted or renamed cannot survive into the snapshot the lanes run on.
if [ "$1" = cached ]; then
  find /home/admin/tao -mindepth 1 -maxdepth 1 ! -name .devenv ! -name .artifacts -exec rm -rf {} +
fi
mkdir -p /home/admin/tao
tar -xf /home/admin/tao-harness/input/checkout.tar -C /home/admin/tao
cd /home/admin/tao
case "$1" in
  cold|cached) mkdir -p .artifacts/logs ;;
esac
exec /bin/sh packages/cli/dev-cli/dev-cli-src/environment/guest-smoke.sh "$1"
GUEST

# The guest receives one archive through the agent: the committed source and this script.
make_harness() {
  mkdir -p "$root/stage/tao-harness" \
    && cp -R "$input" "$root/stage/tao-harness/input" \
    && /usr/bin/tar --no-xattrs -cf "$root/harness.tar" -C "$root/stage" tao-harness \
    && rm -rf "$root/stage"
}
step 'archive the guest inputs' make_harness

# Guest evidence travels as a tar stream through the same transport. The tools phase has no workflow logs.
collect_guest() {
  local -a paths=("contributor-linux/guest-$phase")
  if [ "$phase" != tools ]; then
    paths+=(logs)
  fi
  mkdir -p "$root/$phase/guest" \
    && "$bun_bin" run "$vm_helper" exec "$name" 300000 /usr/bin/tar -cf - -C /home/admin/tao/.artifacts "${paths[@]}" \
      > "$logs/guest-evidence.tar" \
    && /usr/bin/tar -xf "$logs/guest-evidence.tar" -C "$root/$phase/guest"
}

# One phase ($1) in its own clone of the VM named $2: boot, run the guest journey, collect evidence, stop, then delete the clone,
# or, for a successful tools phase, keep it as the tools cache. Sets guest_status to the guest's exit status.
run_phase() {
  phase=$1
  local parent=$2
  name="$stem-$phase"
  logs="$root/$phase/logs"
  mkdir -p "$logs"
  collected=0
  booted=0
  printf 'Contributor Linux: %s phase in %s\n' "$phase" "$name"

  created=1
  if ! step "clone $parent for the $phase phase" tart clone "$parent" "$name" 2>&1 | tee "$logs/clone.log"; then
    exit 1
  fi
  # A cached clone inherits the tools VM's disk, which is already 50 GB.
  if [ "$phase" = cached ]; then
    tart set "$name" --cpu 4 --memory 16384
  else
    tart set "$name" --cpu 4 --memory 16384 --disk-size 50
  fi
  tart get "$name" --format json > "$logs/vm-config.json"
  vm_boot_and_wait
  step 'push the committed source through the guest agent' vm_push "$root/harness.tar" /home/admin

  guest_status=0
  step "run the contributor journey in the $phase guest" \
    "$bun_bin" run "$vm_helper" exec "$name" 7200000 /bin/sh /home/admin/tao-harness/input/run.sh "$phase" \
    2>&1 | tee "$logs/journey.log" || guest_status=$?

  step 'collect guest evidence' collect_guest
  collected=1
  vm_stop_running

  local steps="$root/$phase/guest/contributor-linux/guest-$phase/steps.tsv"
  if [ -f "$steps" ]; then
    printf 'Contributor Linux: %s guest steps (label, exit, seconds)\n' "$phase"
    cat "$steps"
  fi
  if [ "$phase" = tools ] && [ "$guest_status" -eq 0 ]; then
    step "name the tools cache $cache_vm" tart rename "$name" "$cache_vm"
    created=0
  else
    step "delete $name" tart delete "$name"
    created=0
  fi
  printf 'Contributor Linux: %s complete (exit %s); logs: %s\n' "$phase" "$guest_status" "$root/$phase"
}

if [ "$mode" = cold ] || [ "$mode" = both ]; then
  run_phase cold "$image"
  if [ "$guest_status" -ne 0 ]; then result=$guest_status; fi
fi
if [ "$mode" = cached ] || [ "$mode" = both ]; then
  if tart get "$cache_vm" --format json > "$root/cache-vm.json" 2>/dev/null; then
    printf 'Contributor Linux: reusing tools cache %s\n' "$cache_vm"
  else
    run_phase tools "$image"
    if [ "$guest_status" -ne 0 ]; then
      printf 'Cached smoke unrun: tools VM provisioning failed.\n' >&2
      exit "$guest_status"
    fi
  fi
  run_phase cached "$cache_vm"
  if [ "$guest_status" -ne 0 ] && [ "$result" -eq 0 ]; then result=$guest_status; fi
fi
exit "$result"
