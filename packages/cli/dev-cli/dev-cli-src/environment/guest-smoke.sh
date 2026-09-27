#!/bin/sh
# Internal guest entry; the host runner supplies only a committed source archive.
set -eu

case "${1:-}" in cold|cached|tools) mode=$1 ;; *) exit 2 ;; esac
qemu_guest_base=0
qemu_nix_filter=0
case "$#" in
  1) ;;
  2) case "$2" in
       --qemu-guest-base) qemu_guest_base=1 ;;
       --qemu-compat) qemu_guest_base=1; qemu_nix_filter=1 ;;
       *) exit 2 ;;
     esac ;;
  *) exit 2 ;;
esac
cd "$(dirname "$0")/../../../../.."
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
logs="$PWD/.artifacts/contributor-linux/guest-$mode"
mkdir -p "$logs"

finish() {
  result=$?
  trap - EXIT
  du -sk "$PWD" /nix /root > "$logs/disk-kib.txt" 2>&1 || true
  df -Pk "$PWD" > "$logs/filesystem-kib.txt" 2>&1 || true
  printf 'Host-only native and UI lanes were not run.\n' > "$logs/unrun.txt"
  exit "$result"
}
trap finish EXIT

step() {
  label=$1
  shift
  started=$(date +%s)
  printf 'Contributor Linux: %s started; log: %s/%s.log\n' "$label" "$logs" "$label"
  step_result=0
  (
    producer_result=0
    if [ "$qemu_guest_base" -eq 1 ]; then
      set -- QEMU_GUEST_BASE=0x800000000000 "$@"
    fi
    # Explicit emulation diagnostic: QEMU user mode cannot load Nix's inner
    # syscall filter. Docker's outer isolation and default bootstrap stay intact.
    if [ "$qemu_nix_filter" -eq 1 ]; then
      set -- 'NIX_CONFIG=filter-syscalls = false' "$@"
    fi
    env -i HOME=/root USER=root TERM=dumb PATH="$PATH" "$@" 2>&1 || producer_result=$?
    printf '%s\n' "$producer_result" > "$logs/$label.exit-code"
  ) | tee "$logs/$label.log" || step_result=$?
  producer_result=1
  read -r producer_result < "$logs/$label.exit-code" || producer_result=1
  [ "$producer_result" -eq 0 ] || step_result=$producer_result
  printf '%s\t%s\t%s\n' "$label" "$step_result" "$(($(date +%s) - started))" >> "$logs/steps.tsv"
  printf 'Contributor Linux: %s finished (exit %s, %ss); log: %s/%s.log\n' \
    "$label" "$step_result" "$(($(date +%s) - started))" "$logs" "$label"
  return "$step_result"
}

record_tool_versions() {
  step tool-versions /bin/sh -eu -c '
    for tool in bun node zsh just python3; do
      executable="$PWD/.devenv/profile/bin/$tool"
      printf "%s (%s): " "$tool" "$executable"
      "$executable" --version
    done
    for executable in "$PWD/.devenv/profile/bin/nix" "$HOME/.nix-profile/bin/nix" /nix/var/nix/profiles/default/bin/nix; do
      if [ -x "$executable" ]; then
        printf "nix (%s): " "$executable"
        exec "$executable" --version
      fi
    done
    printf "Nix is missing from the managed profile paths.\\n" >&2
    exit 1
  '
}

uname -a > "$logs/platform.txt"
if [ "$mode" = cold ] || [ "$mode" = tools ]; then
  for tool in zsh nix; do
    if command -v "$tool" >> "$logs/before-bootstrap.txt" 2>&1; then
      printf 'Expected %s to be absent before the cold bootstrap.\n' "$tool" >&2
      exit 1
    fi
    printf '%s absent\n' "$tool" >> "$logs/before-bootstrap.txt"
  done
fi

if [ "$mode" = tools ]; then
  step bootstrap-tools ./bootstrap-tao-dev-env --install-nix --tools-only
  record_tool_versions
  exit
fi

git init --quiet --initial-branch=feat/contributor-linux
git config user.name 'Tao Contributor Test'
git config user.email 'contributor-test@example.invalid'
git add --all
git commit --quiet -m 'Contributor Linux source snapshot'
# Changed-test discovery uses main as its base even in this independent checkout.
git branch main
if [ "$mode" = cold ]; then
  step bootstrap ./bootstrap-tao-dev-env --install-nix
else
  step bootstrap ./bootstrap-tao-dev-env
fi
record_tool_versions
step help ./agent help
step setup ./agent setup --verbose
step parser ./agent test-file packages/language/parser/parser-tests/dialect.test.ts --verbose
result=0
step check ./agent check --verbose || result=1
step test ./agent test-all --verbose || result=1
step verify ./agent verify --verbose || result=1
exit "$result"
