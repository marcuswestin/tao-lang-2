#!/bin/bash
# The Developer's one command for the VM images the isolation checks clone: it caches each named
# profile's pinned image and, for vanilla, builds the local base. Runs and agents only check for these
# and print this command when one is missing; they never download or build an image themselves.
set -euo pipefail

if [ "$#" -eq 0 ]; then set -- ubuntu vanilla; fi
for profile in "$@"; do
  case "$profile" in
    ubuntu|vanilla|xcode) ;;
    *) printf 'Usage: just vm-images [ubuntu|vanilla|xcode]...  (default: ubuntu vanilla)\n' >&2; exit 2 ;;
  esac
done

repository=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd -P)
cd "$repository"
source packages/cli/tao-cli/cli-src/vm-guest-lib.sh
vm_label='VM images'
overall_started=$(date +%s)
name="tao-basebuild-$(date +%s)-$$"
root="$repository/.artifacts/vm-images/$name"
input="$root/input"
logs="$root/logs"
lease_root="$HOME/.tao/standalone-vm-lease"
vm_helper='packages/cli/tao-cli/cli-src/standalone-vm.ts'
bun_bin="${TAO_STANDALONE_BUN:-$repository/.devenv/profile/bin/bun}"
lease_owned=0
started=0
booted=0
vm_pid=''
status=0
mkdir -p "$input" "$logs"

cleanup() {
  status=$?
  trap - EXIT
  if [ "$started" -eq 1 ]; then
    tart stop "$running_vm" >> "$logs/cleanup.log" 2>&1 || true
    wait "$vm_pid" >> "$logs/cleanup.log" 2>&1 || true
  fi
  vm_cleanup_base_build
  vm_release_lease
  printf 'VM images: total %ss; exit %s; logs: %s\n' "$(($(date +%s) - overall_started))" "$status" "$logs"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

vm_acquire_lease
vm_require_tart_version
for profile in "$@"; do
  vm_image_for_profile "$profile"
  if grep -Fx "$image" <<< "$(tart list --source oci --quiet)" > /dev/null; then
    printf 'VM images: %s image already cached: %s\n' "$profile" "$image"
  else
    step "download the pinned $profile image (tens of gigabytes the first time)" tart pull "$image"
  fi
  if [ "$profile" = vanilla ]; then
    if vm_vanilla_base_current; then
      printf 'VM images: local base %s is current (%s)\n' "$vanilla_base" "$manifest"
    else
      vm_build_vanilla_base
    fi
  fi
done
printf 'VM images: ready: %s\n' "$*"
