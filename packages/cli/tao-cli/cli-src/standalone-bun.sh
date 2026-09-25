#!/bin/bash
# Fetch the portable Bun used to compile macOS release binaries. Nix's Bun embeds /nix/store
# dylib paths into compiled output, which cannot launch on a clean machine.
set -euo pipefail

version=1.4.2
archive_name=bun-darwin-aarch64.zip
archive_sha=90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f
binary_sha=35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5
root=.artifacts/standalone-toolchain
archive="$root/bun-darwin-aarch64-$version.zip"
binary="$root/bun-$version"
temporary=''

cleanup() {
  if [ -n "$temporary" ]; then
    rm -f "$temporary"
  fi
}
trap cleanup EXIT

hash_matches() {
  [ -f "$1" ] && [ "$(shasum -a 256 "$1" | cut -d ' ' -f 1)" = "$2" ]
}

mkdir -p "$root"
if ! hash_matches "$binary" "$binary_sha"; then
  if ! hash_matches "$archive" "$archive_sha"; then
    temporary=$(mktemp "$root/.bun-download.XXXXXX")
    printf 'Downloading portable Bun %s for the standalone release...\n' "$version" >&2
    curl --fail --location --retry 3 --progress-bar \
      "https://github.com/oven-sh/bun/releases/download/bun-v$version/$archive_name" \
      --output "$temporary"
    if ! hash_matches "$temporary" "$archive_sha"; then
      printf 'Portable Bun download did not match its pinned SHA-256.\n' >&2
      exit 1
    fi
    mv "$temporary" "$archive"
    temporary=''
  fi
  temporary=$(mktemp "$root/.bun-binary.XXXXXX")
  unzip -p "$archive" bun-darwin-aarch64/bun > "$temporary"
  if ! hash_matches "$temporary" "$binary_sha"; then
    printf 'Portable Bun binary did not match its pinned SHA-256.\n' >&2
    exit 1
  fi
  chmod +x "$temporary"
  mv "$temporary" "$binary"
  temporary=''
fi

printf '%s/%s\n' "$(pwd)" "$binary"
