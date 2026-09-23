#!/bin/sh
# Installs the standalone Tao CLI:
#
#   curl -fsSL @TAO_RELEASES@/latest/download/install.sh | sh
#
# TAO_VERSION=0.4.0 installs that release instead of the latest. TAO_HOME relocates everything this
# writes, which is otherwise ${XDG_DATA_HOME:-~/.local/share}/tao. TAO_RELEASES points at another
# copy of the releases, which is how the acceptance run installs a build that is not published.
#
# `standalone-build.ts --release` fills in @TAO_RELEASES@ when it publishes this file beside the
# binary it installs.

set -eu

releases="${TAO_RELEASES:-@TAO_RELEASES@}"
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

for tool in curl shasum gunzip; do
  command -v "$tool" > /dev/null 2>&1 || fail "this needs \`$tool\`, which is not on PATH."
done

if [ -n "$requested" ]; then
  download="$releases/download/v$requested"
else
  download="$releases/latest/download"
fi
asset="tao-$target.gz"

mkdir -p "$tao_home/versions" "$tao_home/bin"
# Staged inside versions/ so the final move is a rename on one filesystem, and so the first run below
# unpacks the resources exactly where they will stay.
staging="$(mktemp -d "$tao_home/versions/.install.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

printf 'Downloading Tao %s for %s...\n' "${requested:-(latest)}" "$target"
curl -fsSL "$download/$asset" -o "$staging/$asset" || fail "could not download $download/$asset."
curl -fsSL "$download/$asset.sha256" -o "$staging/$asset.sha256" || fail "could not download its checksum."

expected="$(awk '{ print $1 }' "$staging/$asset.sha256")"
actual="$(shasum -a 256 "$staging/$asset" | awk '{ print $1 }')"
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "the download does not match its published checksum."

gunzip -c "$staging/$asset" > "$staging/tao"
rm -f "$staging/$asset" "$staging/$asset.sha256"
chmod 755 "$staging/tao"

# The binary names its own version, so nothing here parses a release index, and this first run also
# unpacks the resources it carries beside it.
version="$("$staging/tao" --version)" || fail "the downloaded binary did not run."
if [ -n "$requested" ] && [ "$version" != "$requested" ]; then
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
