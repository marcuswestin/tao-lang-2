#!/bin/bash
# Fixed host operation. Proves the documented contributor path in a fresh vanilla macOS VM, as
# contributor-linux-test.sh does in Ubuntu containers. It never accepts paths, VM names, or guest
# commands, and only the committed source (never the working tree or its credentials) enters the guest.
set -euo pipefail

profile=vanilla
case "$#" in
  0) ;;
  2)
    if [ "$1" = --base ] && { [ "$2" = vanilla ] || [ "$2" = xcode ]; }; then
      profile=$2
    else
      printf 'Expected --base vanilla or --base xcode.\n' >&2
      exit 2
    fi ;;
  *) printf 'Usage: contributor-macos-test [--base vanilla|xcode]\n' >&2; exit 2 ;;
esac

# The repository is the one this script lives in, whatever the caller's directory.
repository=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd -P)
cd "$repository"
source packages/cli/tao-cli/cli-src/vm-guest-lib.sh
vm_label='Contributor macOS'
vm_image_for_profile "$profile"

# The run directory doubles as the VM helper's run root: it holds the lease record, the mounted-disk
# marker, and the provisioned input. The VM name carries the pid so the lease names its owner.
overall_started=$(date +%s)
run="$(date -u +%Y%m%dT%H%M%SZ)-$$"
name="tao-contributor-$(date +%s)-$$"
root="$repository/.artifacts/contributor-macos/$run"
input="$root/input"
logs="$root/logs"
lease_root="$HOME/.tao/standalone-vm-lease"
vm_helper='packages/cli/tao-cli/cli-src/standalone-vm.ts'
bun_bin="${TAO_STANDALONE_BUN:-$repository/.devenv/profile/bin/bun}"
lease_owned=0
created=0
started=0
booted=0
collected=0
vm_pid=''
status=0

mkdir -p "$input" "$logs"
printf '%s\n' "$root" > "$repository/.artifacts/contributor-macos/latest.txt"
printf 'Contributor macOS evidence: %s\n' "$root"

# The clone is deleted once its guest evidence is on this host. A clone whose evidence was not
# collected, or whose disk may still be mounted, is kept for inspection and named here.
cleanup() {
  status=$?
  trap - EXIT
  if [ "$started" -eq 1 ]; then
    tart stop "$name" >> "$logs/cleanup.log" 2>&1 || true
    wait "$vm_pid" >> "$logs/cleanup.log" 2>&1 || true
  fi
  if [ -f "$root/disk-attached" ]; then
    printf 'Contributor macOS: retaining VM %s because its disk may still be mounted; see %s\n' "$name" "$root/disk-attached" >&2
    status=1
  elif [ "$booted" -eq 1 ] && [ "$collected" -ne 1 ]; then
    printf 'Contributor macOS: retaining stopped VM %s because guest evidence was not collected; delete it with tart delete %s\n' "$name" "$name" >&2
    status=1
  elif [ "$created" -eq 1 ]; then
    if ! tart delete "$name" >> "$logs/cleanup.log" 2>&1; then
      printf 'Contributor macOS: could not delete VM %s; see %s\n' "$name" "$logs/cleanup.log" >&2
      status=1
    fi
  fi
  vm_release_lease
  printf 'exit_code=%s\nwall_seconds=%s\n' "$status" "$(($(date +%s) - overall_started))" >> "$root/result.txt"
  printf 'Contributor macOS: total %ss\n' "$(($(date +%s) - overall_started))"
  printf 'Contributor macOS exit %s; evidence: %s\n' "$status" "$root"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

vm_acquire_lease
printf 'Contributor macOS: profile %s, pinned image %s\n' "$profile" "$image"
vm_require_tart_version
if ! command -v "$bun_bin" >/dev/null; then
  printf 'The checkout Bun is unavailable: %s. Run ./enter-tao-dev-env first.\n' "$bun_bin" >&2
  exit 1
fi

git rev-parse HEAD > "$root/source-commit.txt"
git status --porcelain > "$root/host-dirty-state.txt"
printf '%s\n' \
  "profile=$profile" "image=$image" 'guest_cpus=4' 'guest_memory_mib=16384' 'guest_timeout_seconds=7200' \
  'host_only_native_ui_lanes=unrun' \
  'source=git archive HEAD in a fresh repository; uncommitted changes excluded' > "$root/resources.txt"

# A new contributor clones. The vanilla guest has no Git until the toolchain provides one, so this
# host makes the same thing from the committed source: one commit on a feature branch, plus main,
# which changed-test discovery reads as its base.
commit_identity=(-c user.name='Tao Contributor Test' -c user.email='contributor-test@example.invalid' -c commit.gpgsign=false)
# A function run by step is exempt from errexit, so each command hands its failure to the next.
make_source() {
  # Not a pipe: tar stops reading at its end marker, and a still-writing git archive would die of SIGPIPE.
  mkdir -p "$root/stage/tao" \
    && git archive --format=tar --output="$root/stage/head.tar" HEAD \
    && /usr/bin/tar -xf "$root/stage/head.tar" -C "$root/stage/tao" \
    && rm "$root/stage/head.tar" \
    && git -C "$root/stage/tao" init --quiet --initial-branch=feat/contributor-macos \
    && git -C "$root/stage/tao" "${commit_identity[@]}" add --all \
    && git -C "$root/stage/tao" "${commit_identity[@]}" commit --quiet -m 'Contributor macOS source snapshot' \
    && git -C "$root/stage/tao" branch main \
    && /usr/bin/tar --no-xattrs -cf "$input/checkout.tar" -C "$root/stage" tao \
    && rm -rf "$root/stage"
}
step 'archive the committed source for the guest' make_source

cat > "$input/run.sh" <<'GUEST'
#!/bin/sh
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
/usr/bin/tar -xf /Users/admin/tao-harness/input/checkout.tar -C /Users/admin
cd /Users/admin/tao
exec /bin/sh packages/cli/dev-cli/dev-cli-src/environment/contributor-macos-guest.sh "$1"
GUEST

vm_install_guest_agent

created=1
if ! step "clone the $profile base" tart clone "$image" "$name" 2>&1 | tee "$logs/clone.log"; then
  exit 1
fi
tart set "$name" --cpu 4 --memory 16384
tart get "$name" --format json > "$logs/vm-config.json"
step 'provision the stopped clone' "$bun_bin" run "$vm_helper" provision "$name" "$root" \
  2>&1 | tee "$logs/provision.log"
vm_boot_and_wait

guest_status=0
step "run the contributor journey in the $profile guest" \
  "$bun_bin" run "$vm_helper" exec "$name" 7200000 /bin/sh /Users/admin/tao-harness/input/run.sh "$profile" \
  2>&1 | tee "$logs/console.log" || guest_status=$?

# Guest evidence travels as a tar stream through the same transport, then the clone is stopped.
collect_guest() {
  "$bun_bin" run "$vm_helper" exec "$name" 300000 /usr/bin/tar -cf - -C /Users/admin/tao/.artifacts contributor-macos \
    > "$logs/guest-evidence.tar" \
    && mkdir "$root/guest" \
    && /usr/bin/tar -xf "$logs/guest-evidence.tar" -C "$root/guest"
}
step 'collect guest evidence' collect_guest
collected=1
step 'flush guest evidence before stopping the VM' "$bun_bin" run "$vm_helper" exec "$name" 30000 /bin/sync
step 'stop the VM' tart stop "$name"
wait "$vm_pid" || true
started=0

printf 'Contributor macOS: guest steps (label, exit, seconds)\n'
cat "$root/guest/contributor-macos/steps.tsv"
exit "$guest_status"
