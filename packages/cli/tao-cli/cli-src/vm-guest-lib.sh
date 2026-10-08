# Sourced by the disposable Tart VM runners: standalone-clean-machine.sh, contributor-macos-test.sh, and
# contributor-linux-test.sh.
# The caller sets vm_label, name, root, logs, input, lease_root, bun_bin, and vm_helper first, owns its
# cleanup trap and the variables that trap reads (lease_owned, started, booted, vm_pid, running_vm,
# base_build_vm), and calls these only for the steps both runners must do identically: one
# account-wide lease, one local vanilla base with the pinned guest agent, one headless boot with a
# readiness wait, and pushing inputs through the agent.

vm_image_for_profile() {
  case "$1" in
    vanilla) image='ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bfe1f076e27786c5d92b89187a05b1d109b5071eb2dcdf02d596e34640' ;;
    xcode) image='ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:71d9dc1d6c4614b7ecbb328753124912b43425fc8cf1c4085d7f352026df6601' ;;
    # Ubuntu 24.04 for arm64, as published 2026-10-03; it ships the guest agent as a systemd unit.
    ubuntu) image='ghcr.io/cirruslabs/ubuntu@sha256:e004f7f4f6765e2b3ae2738a95040c5d03867b667eb21a57ea0c3729aad640b6' ;;
  esac
}

agent_version=0.10.0
agent_sha=303a50d452753e36776ce8775e243be580bb3fc3ec8efde154320c37fd65b1a7
vanilla_base=tao-base-vanilla
running_vm=''
base_build_vm=''

step() {
  label=$1
  shift
  began=$(date +%s)
  printf '%s: %s...\n' "$vm_label" "$label"
  if "$@"; then
    printf '%s: %s passed in %ss\n' "$vm_label" "$label" "$(($(date +%s) - began))"
  else
    status=$?
    printf '%s: %s failed after %ss (exit %s); see %s\n' "$vm_label" "$label" "$(($(date +%s) - began))" "$status" "$logs" >&2
    return "$status"
  fi
}

# A shared account-wide lease coordinates our worktrees. Ambiguous/stale owners require inspection;
# age alone is never evidence that a Tart child or mounted disk has stopped.
vm_acquire_lease() {
  if ! command -v tart >/dev/null; then
    printf 'Tart is required for the clean-machine gate.\n' >&2
    exit 1
  fi
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
}

vm_require_tart_version() {
  tart_version=$(tart --version)
  IFS=. read -r tart_major tart_minor tart_patch <<< "$tart_version"
  if (( tart_major < 2 || (tart_major == 2 && tart_minor < 32) || (tart_major == 2 && tart_minor == 32 && tart_patch < 1) )); then
    printf 'Tart 2.32.1 or newer is required for this guest-agent transport; found %s.\n' "$tart_version" >&2
    exit 1
  fi
}

# Release only a lease this run created, and only once no Tart child or mounted disk can remain.
vm_release_lease() {
  if [ "$lease_owned" -eq 1 ]; then
    if [ -f "$root/disk-attached" ] || { [ -n "$vm_pid" ] && kill -0 "$vm_pid" 2>/dev/null; }; then
      printf '%s: retaining VM lease %s; inspect its owner and the VM before recovery.\n' "$vm_label" "$lease_root" >&2
      status=1
    else
      rm -f "$lease_root/owner.txt"
      rmdir "$lease_root"
    fi
  fi
}

# The vanilla image deliberately has no agent or developer tools. Fetch only the pinned RPC fixture.
vm_fetch_guest_agent() {
  agent_archive="$(pwd)/.artifacts/standalone-toolchain/tart-guest-agent-$agent_version.tar.gz"
  mkdir -p "$(dirname "$agent_archive")"
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
  mkdir -p "$root/agent"
  /usr/bin/tar -xzf "$agent_archive" -C "$root/agent" tart-guest-agent
}

# Sets base_vm to the VM a run clones. The xcode image ships its own agent. The vanilla image gets a
# local base, built once per source digest and agent: the pinned agent written to the stopped disk
# with ownership ignored, then one boot proving `tart exec` answers. Pass 1 to rebuild regardless.
vm_prepare_base() {
  if [ "$profile" != vanilla ]; then
    base_vm=$image
    return
  fi
  base_vm=$vanilla_base
  manifest="$HOME/.tao/vm-bases/$vanilla_base.txt"
  expected=$(printf 'source=%s\nagent=%s %s\n' "$image" "$agent_version" "$agent_sha")
  if [ "${1:-0}" -ne 1 ] && [ -f "$manifest" ] && [ "$(head -n 2 "$manifest")" = "$expected" ] \
    && tart get "$vanilla_base" --format json > /dev/null 2>&1; then
    printf '%s: reusing local base %s (%s)\n' "$vm_label" "$vanilla_base" "$manifest"
    return
  fi
  vm_fetch_guest_agent
  base_build_vm="tao-basebuild-$(date +%s)-$$"
  if ! step 'clone the vanilla image for the local base' tart clone "$image" "$base_build_vm" \
    > "$logs/base-clone.log" 2>&1; then
    cat "$logs/base-clone.log" >&2
    exit 1
  fi
  step 'write only the guest agent to the stopped base disk' \
    "$bun_bin" run "$vm_helper" bootstrap-agent "$base_build_vm" "$root" 2>&1 | tee "$logs/base-bootstrap.log"
  vm_boot_and_wait "$base_build_vm"
  vm_stop_running
  rm -f "$manifest"
  if tart get "$vanilla_base" --format json > /dev/null 2>&1; then
    step 'remove the outdated local base' tart delete "$vanilla_base"
  fi
  step 'name the local base' tart rename "$base_build_vm" "$vanilla_base"
  base_build_vm=''
  mkdir -p "$(dirname "$manifest")"
  printf '%s\nbuilt=%s\n' "$expected" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$manifest"
  printf '%s: built local base %s (%s)\n' "$vm_label" "$vanilla_base" "$manifest"
}

# Delete a base build that never became the local base; one whose disk may be mounted stays for inspection.
vm_cleanup_base_build() {
  if [ -n "$base_build_vm" ]; then
    if [ -f "$root/disk-attached" ]; then
      printf '%s: retaining base build %s because its disk may still be mounted\n' "$vm_label" "$base_build_vm" >&2
      status=1
      return
    fi
    if ! "$bun_bin" run "$vm_helper" collect "$base_build_vm" "$root" >> "$logs/cleanup.log" 2>&1; then
      printf '%s: could not collect evidence from base build %s; see %s\n' "$vm_label" "$base_build_vm" "$logs/cleanup.log" >&2
    fi
    if ! tart delete "$base_build_vm" >> "$logs/cleanup.log" 2>&1; then
      printf '%s: could not delete base build %s; see %s\n' "$vm_label" "$base_build_vm" "$logs/cleanup.log" >&2
      status=1
    fi
  fi
}

# Extract a host archive under the guest admin's home through the agent; it never touches the stopped disk.
vm_push() {
  "$bun_bin" run "$vm_helper" push "$name" 1800000 "$2" < "$1"
}

# Flush, stop, and reap the running VM; the caller's trap stops it when any step fails first.
vm_stop_running() {
  step 'flush guest writes before stopping the VM' "$bun_bin" run "$vm_helper" exec "$running_vm" 30000 /bin/sync
  step "stop $running_vm" tart stop "$running_vm"
  wait "$vm_pid" || true
  started=0
  running_vm=''
}

# Boot a stopped VM (the run's clone unless named) without graphics and wait until `tart exec` answers twice in a row.
vm_boot_and_wait() {
  running_vm=${1:-$name}
  printf '%s: booting %s headless...\n' "$vm_label" "$running_vm"
  boot_started=$(date +%s)
  "$bun_bin" run "$vm_helper" boot "$running_vm" "$root" >> "$logs/boot.log" 2>&1 &
  vm_pid=$!
  started=1
  if [ "$running_vm" = "$name" ]; then booted=1; fi

  deadline=$(($(date +%s) + 240))
  last_wait_report=$boot_started
  ready_streak=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if ! kill -0 "$vm_pid" 2>/dev/null; then
      printf '%s: guest exited during boot; see %s\n' "$vm_label" "$logs/boot.log" >&2
      exit 1
    fi
    if "$bun_bin" run "$vm_helper" exec "$running_vm" 10000 /usr/bin/true >> "$logs/exec-ready.log" 2>&1; then
      ready_streak=$((ready_streak + 1))
      if [ "$ready_streak" -ge 2 ]; then
        break
      fi
    else
      ready_streak=0
    fi
    now=$(date +%s)
    if (( now - last_wait_report >= 15 )); then
      printf '%s: waiting for tart exec (%ss elapsed); see %s\n' \
        "$vm_label" "$((now - boot_started))" "$logs/exec-ready.log"
      last_wait_report=$now
    fi
    sleep 3
  done
  if [ "$ready_streak" -lt 2 ]; then
    printf '%s: tart exec did not become ready; see %s\n' "$vm_label" "$logs" >&2
    if [ -f "$logs/exec-ready.log" ]; then
      tail -n 4 "$logs/exec-ready.log" >&2
    fi
    exit 1
  fi
  printf '%s: tart exec ready in %ss\n' "$vm_label" "$(($(date +%s) - boot_started))"
}
