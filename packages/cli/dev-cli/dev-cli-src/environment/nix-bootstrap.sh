#!/bin/sh
# Explicit Linux Nix installation; repository dependencies belong to ./agent setup.
set -eu

if [ "$#" -ne 0 ]; then
  printf 'The Nix bootstrap takes no arguments.\n' >&2
  exit 2
fi
if [ "$(uname -s)" != Linux ]; then
  printf 'Nix bootstrap supports Linux only.\n' >&2
  exit 1
fi
# SHA-256 values published by https://releases.nixos.org/nix/nix-2.35.2/install.
case "$(uname -m)" in
  x86_64)
    system=x86_64-linux
    archive_sha256=0c3960a9792331a22081c3c7a5d8465db9b17c50b3acdf18587fa4c6f2cb1158 ;;
  aarch64)
    system=aarch64-linux
    archive_sha256=4d0302a2910f5eec1c33b8deef634f04899a75737e7001ec49908d003ae5efda ;;
  *) printf 'Nix bootstrap supports Linux x86_64 and aarch64 only.\n' >&2; exit 1 ;;
esac

# Setup hooks can overlap before the parent acquires its profile-build lock.
if ! command -v flock >/dev/null 2>&1; then
  printf 'Nix bootstrap needs flock from the Linux base image.\n' >&2
  exit 1
fi
mkdir -p "$HOME/.local/state/tao-contributor"
exec 9>"$HOME/.local/state/tao-contributor/nix-bootstrap.lock"
flock -w 600 9 || { printf 'Timed out waiting for Nix installation.\n' >&2; exit 1; }
marker="$HOME/.local/state/tao-contributor/nix-bootstrap"
pending="$marker.pending"
if [ -e "$pending" ] || [ -L "$pending" ]; then
  printf 'An earlier Nix bootstrap did not complete; pending installation marker: %s\n' "$pending" >&2
  printf 'Discard and recreate the disposable Linux guest, or recover its installation manually before removing this marker.\n' >&2
  exit 1
fi

# An existing installation is never replaced, even when its version differs.
for nix_bin in "$(command -v nix-build || true)" "$HOME/.nix-profile/bin/nix-build" /nix/var/nix/profiles/default/bin/nix-build; do
  if [ -n "$nix_bin" ] && [ -x "$nix_bin" ]; then
    printf 'Nix bootstrap: reusing %s\n' "$nix_bin"
    exit 0
  fi
done

version=2.35.2
archive_name="nix-$version-$system"
for required in curl sha256sum tar xz mktemp readlink; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'Nix bootstrap needs %s from the Linux base image.\n' "$required" >&2
    exit 1
  fi
done

mkdir -p .artifacts/nix-bootstrap
download=$(mktemp -d "$PWD/.artifacts/nix-bootstrap/download.XXXXXXXX")
marker_temporary=
cleanup() {
  status=$?
  trap - EXIT
  rm -rf -- "$download" || status=1
  if [ -n "$marker_temporary" ]; then
    rm -f -- "$marker_temporary" || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Nix bootstrap: downloading Nix %s for %s...\n' "$version" "$system"
curl --fail --location --proto '=https' --proto-redir '=https' \
  --output "$download/$archive_name.tar.xz" \
  "https://releases.nixos.org/nix/nix-$version/$archive_name.tar.xz"
if ! (cd "$download" && printf '%s  %s.tar.xz\n' "$archive_sha256" "$archive_name" | sha256sum --check --status); then
  printf 'Nix bootstrap checksum verification failed; installer was not executed.\n' >&2
  exit 1
fi
tar -xJf "$download/$archive_name.tar.xz" -C "$download"

# Retain this marker across failure or interruption, even if the installer has
# already created a usable-looking profile. Only full success removes it.
printf 'version=%s\nprofile=%s\n' "$version" "$HOME/.nix-profile" > "$pending"
root_install=false
if [ "$(id -u)" = 0 ]; then
  root_install=true
  # The upstream single-user installer otherwise invokes sudo even as root.
  # Do not change permissions or ownership of an existing store directory.
  mkdir -p /nix
  # Scope the single-user container settings to this process. The parent uses
  # the successful-install marker to apply the same settings to nix-build.
  NIX_CONFIG="${NIX_CONFIG:+$NIX_CONFIG
}store = local
build-users-group =
sandbox = false"
  export NIX_CONFIG
fi
printf '%s\n' \
  'owner=explicit contributor Linux Nix bootstrap in the disposable guest' \
  'store=/nix' \
  "profile=$HOME/.nix-profile" \
  "root_install_marker=$marker" \
  "installation_lock=$marker.lock" \
  "pending_installation=$pending" \
  'cleanup=remove the disposable guest; never remove a host Nix installation' \
  'installer failure can leave partial guest store or profile state; no rollback deletes these paths' \
  > .artifacts/nix-bootstrap/ownership.txt
/bin/sh "$download/$archive_name/install" --no-daemon --no-channel-add --no-modify-profile --yes
installed="$HOME/.nix-profile/bin/nix-build"
if [ ! -x "$installed" ]; then
  printf 'Nix installer completed without an executable user-profile nix-build.\n' >&2
  exit 1
fi
if "$root_install"; then
  resolved=$(readlink -f "$installed")
  mkdir -p "$HOME/.local/state/tao-contributor"
  marker_temporary="$marker.next-$$"
  printf '%s\n' "$resolved" > "$marker_temporary"
  mv -f "$marker_temporary" "$marker"
  marker_temporary=
fi
rm -f -- "$pending"
printf 'Nix bootstrap: installed Nix %s at %s\n' "$version" "$installed"
