#!/bin/sh
# Installs the standalone Tao CLI:
#
#   curl -fsSL @TAO_RELEASES@/download/v@TAO_VERSION@/install.sh | sh
#
# The unpinned installer chooses the highest stable vVERSION release, leaving GitHub's repository-wide
# latest marker to Studio. TAO_VERSION=0.4.0 installs that exact release. TAO_HOME relocates everything
# this writes, which is otherwise ~/.tao. TAO_RELEASES points at another
# copy of the releases; TAO_RELEASE_INDEX_URL supplies its release listing for a mirror or local test.
#
# `standalone-build.ts --release` fills in the release URL and version when it publishes this file
# beside the binary it installs.

set -eu

releases="${TAO_RELEASES:-@TAO_RELEASES@}"
releases="${releases%/}"
requested="${TAO_VERSION:-}"

fail() {
  printf 'Tao install: %s\n' "$*" >&2
  exit 1
}

# Match TaoHome in the binary: a declared home must be absolute.
if [ -n "${TAO_HOME:-}" ]; then
  case "$TAO_HOME" in
    /*) tao_home="$TAO_HOME" ;;
    *) fail "TAO_HOME must be an absolute path; it was $TAO_HOME." ;;
  esac
else
  tao_home="$HOME/.tao"
fi

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=darwin-arm64 ;;
  *) fail "Tao is built only for macOS on Apple silicon so far, and this is $(uname -s) on $(uname -m)." ;;
esac

for tool in curl shasum gunzip awk grep plutil stat id; do
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

# The binary confirms the selected version and unpacks the resources it carries beside it. It is asked
# from `/` with no version named, so a project pin in the current directory cannot hand the check to
# another installed release.
version="$(cd / && unset TAO_VERSION && "$staging/tao" --version)" || fail "the downloaded binary did not run."
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

printf 'Installed Tao %s in %s.\n' "$version" "$destination"
# Use the first safe directory on PATH. A later link is useless if an earlier `tao` would shadow it.
# Only write a link in a directory owned by this user; never replace someone else's command.
path_bin=''
remaining_path="$PATH:"
while [ -n "$remaining_path" ]; do
  directory="${remaining_path%%:*}"
  remaining_path="${remaining_path#*:}"
  [ -n "$directory" ] || continue
  case "$directory" in /*) ;; *) continue ;; esac
  [ -d "$directory" ] || continue
  if [ "$directory" = "$tao_home/bin" ]; then
    path_bin="$directory"
    break
  fi
  if [ -e "$directory/tao" ] || [ -L "$directory/tao" ]; then
    if [ -L "$directory/tao" ] && [ "$(readlink "$directory/tao")" = "$tao_home/bin/tao" ]; then
      path_bin="$directory"
    fi
    break
  fi
  if [ -w "$directory" ] && [ "$(stat -f %u "$directory")" = "$(id -u)" ]; then
    path_bin="$directory"
    break
  fi
done
if [ -n "$path_bin" ]; then
  if [ "$path_bin" != "$tao_home/bin" ]; then
    ln -sfn "$tao_home/bin/tao" "$path_bin/tao"
    printf 'Linked tao in %s.\n' "$path_bin"
  fi
else
  case "${SHELL:-}" in
    */zsh) startup_file='~/.zshrc' ;;
    */bash) startup_file='~/.bash_profile' ;;
    *) startup_file='your shell startup file' ;;
  esac
  printf 'No safe writable directory on PATH can expose tao. Add this line to %s, then open a new shell:\n\n  export PATH="%s:$PATH"\n\n' \
    "$startup_file" "$tao_home/bin"
  if [ -z "${TAO_HOME:-}" ] && [ -t 2 ] && [ -r /dev/tty ]; then
    case "${SHELL:-}" in
      */zsh) startup_path="$HOME/.zshrc" ;;
      */bash) startup_path="$HOME/.bash_profile" ;;
      *) startup_path='' ;;
    esac
    if [ -n "$startup_path" ]; then
      printf 'Add that PATH line to %s now? [y/N] ' "$startup_path" > /dev/tty
      IFS= read -r answer < /dev/tty || answer=''
      case "$answer" in
        y|Y|yes|YES)
          if [ -e "$startup_path" ] && [ ! -w "$startup_path" ]; then
            printf 'Cannot write %s; add the line yourself.\n' "$startup_path" >&2
          else
            path_line='export PATH="$HOME/.tao/bin:$PATH"'
            if [ ! -e "$startup_path" ] || ! grep -Fqx "$path_line" "$startup_path"; then
              printf '\n%s\n' "$path_line" >> "$startup_path"
            fi
            printf 'Added the Tao PATH line to %s. Open a new shell to use tao.\n' "$startup_path"
          fi
          ;;
      esac
    fi
  fi
fi
printf 'Start with: tao create "A tally counter"\n'
