#!/bin/sh
# Installs the standalone Tao CLI:
#
#   curl -fsSL @TAO_RELEASES@/download/v@TAO_VERSION@/install.sh | sh
#
# The unpinned installer chooses the highest stable vVERSION release, leaving GitHub's repository-wide
# latest marker to Studio. TAO_VERSION=0.4.0 installs that exact release. TAO_HOME relocates everything
# this writes, which is otherwise ${XDG_DATA_HOME:-~/.local/share}/tao. TAO_RELEASES points at another
# copy of the releases; TAO_RELEASE_INDEX_URL supplies its release listing for a mirror or local test.
#
# `standalone-build.ts --release` fills in the release URL and version when it publishes this file
# beside the binary it installs.

set -eu

releases="${TAO_RELEASES:-@TAO_RELEASES@}"
releases="${releases%/}"
requested="${TAO_VERSION:-}"
tao_home="${TAO_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/tao}"

fail() {
  printf 'Tao install: %s\n' "$*" >&2
  exit 1
}

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=darwin-arm64 ;;
  *) fail "Tao is built only for macOS on Apple silicon so far, and this is $(uname -s) on $(uname -m)." ;;
esac

for tool in curl shasum gunzip awk grep plutil; do
  command -v "$tool" > /dev/null 2>&1 || fail "this needs \`$tool\`, which is not on PATH."
done

stable_version() {
  printf '%s\n' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
}

version_newer() {
  awk -v candidate="$1" -v current="$2" 'BEGIN {
    split(candidate, a, ".")
    split(current, b, ".")
    for (i = 1; i <= 3; i++) {
      if (a[i] + 0 > b[i] + 0) exit 0
      if (a[i] + 0 < b[i] + 0) exit 1
    }
    exit 1
  }'
}

if [ -n "$requested" ]; then
  stable_version "$requested" || fail "TAO_VERSION must be a stable three-part version."
fi
asset="tao-$target.gz"

mkdir -p "$tao_home/versions" "$tao_home/bin"
# Staged inside versions/ so the final move is a rename on one filesystem, and so the first run below
# unpacks the resources exactly where they will stay.
staging="$(mktemp -d "$tao_home/versions/.install.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

if [ -z "$requested" ]; then
  if [ -z "${TAO_RELEASE_INDEX_URL:-}" ]; then
    case "$releases" in
      https://github.com/*/*/releases)
        repository="${releases#https://github.com/}"
        repository="${repository%/releases}"
        index_base="https://api.github.com/repos/$repository/releases"
        ;;
      *) fail "an unpinned install from this release host needs TAO_RELEASE_INDEX_URL." ;;
    esac
  fi
  best=""
  page=1
  while :; do
    index_url="${TAO_RELEASE_INDEX_URL:-$index_base?per_page=100&page=$page}"
    curl -fsSL -H 'Accept: application/vnd.github+json' "$index_url" -o "$staging/releases.json" \
      || fail "could not list published releases at $index_url."
    index=0
    while tag="$(plutil -extract "$index.tag_name" raw -o - "$staging/releases.json" 2> /dev/null)"; do
      draft="$(plutil -extract "$index.draft" raw -o - "$staging/releases.json" 2> /dev/null)" \
        || fail "the release listing is missing a draft flag."
      prerelease="$(plutil -extract "$index.prerelease" raw -o - "$staging/releases.json" 2> /dev/null)" \
        || fail "the release listing is missing a prerelease flag."
      candidate="${tag#v}"
      if [ "$draft" = false ] && [ "$prerelease" = false ] && [ "$tag" = "v$candidate" ] \
        && stable_version "$candidate"; then
        if [ -z "$best" ] || version_newer "$candidate" "$best"; then
          best="$candidate"
        fi
      fi
      index=$((index + 1))
    done
    [ -n "${TAO_RELEASE_INDEX_URL:-}" ] && break
    [ "$index" -lt 100 ] && break
    page=$((page + 1))
  done
  [ -n "$best" ] || fail "no published stable Tao CLI release was found."
  requested="$best"
fi
download="$releases/download/v$requested"

printf 'Downloading Tao %s for %s...\n' "$requested" "$target"
curl -fsSL "$download/$asset" -o "$staging/$asset" || fail "could not download $download/$asset."
curl -fsSL "$download/$asset.sha256" -o "$staging/$asset.sha256" || fail "could not download its checksum."

expected="$(awk '{ print $1 }' "$staging/$asset.sha256")"
actual="$(shasum -a 256 "$staging/$asset" | awk '{ print $1 }')"
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "the download does not match its published checksum."

gunzip -c "$staging/$asset" > "$staging/tao"
rm -f "$staging/$asset" "$staging/$asset.sha256"
chmod 755 "$staging/tao"

# The binary confirms the selected version and unpacks the resources it carries beside it.
version="$("$staging/tao" --version)" || fail "the downloaded binary did not run."
if [ "$version" != "$requested" ]; then
  fail "asked for $requested, but the download is $version."
fi

destination="$tao_home/versions/$version"
if [ -e "$destination" ]; then
  retired="$tao_home/versions/.retired.$$"
  mv "$destination" "$retired"
  mv "$staging" "$destination"
  rm -rf "$retired"
else
  mv "$staging" "$destination"
fi
ln -sfn "$destination/tao" "$tao_home/bin/tao"

# Link into a bin directory the user already has on PATH, if one of theirs is writable and does not
# hold some other `tao`; otherwise print the one line that puts Tao's own bin directory on PATH.
linked=""
old_ifs="$IFS"
IFS=:
for directory in $PATH; do
  case "$directory" in
    "$HOME"/*) ;;
    *) continue ;;
  esac
  [ -d "$directory" ] && [ -w "$directory" ] || continue
  candidate="$directory/tao"
  if [ -e "$candidate" ] || [ -L "$candidate" ]; then
    case "$(readlink "$candidate" 2> /dev/null || true)" in
      "$tao_home"/*) ;;
      *) continue ;;
    esac
  fi
  ln -sfn "$tao_home/bin/tao" "$candidate"
  linked="$candidate"
  break
done
IFS="$old_ifs"

printf 'Installed Tao %s in %s.\n' "$version" "$destination"
if [ -n "$linked" ]; then
  printf 'Linked %s, so `tao` is ready in any new shell.\n' "$linked"
else
  printf 'Add Tao to PATH, for example in ~/.zshrc:\n\n  export PATH="%s:$PATH"\n\n' "$tao_home/bin"
fi
printf 'Start with: tao create "A tally counter"\n'
