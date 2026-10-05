#!/bin/bash
# Fixed SDK downloader only. The private supervisor derives every argument; no command plan chooses an executable.
[ "$#" -eq 6 ] || exit 71
generation=$1
root=$2
runtime=$3
helper=$4
case "$generation" in *[!0-9a-fA-F-]*|'') exit 71 ;; esac
[ "${#generation}" -eq 36 ] || exit 71
script_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 71
[ "$helper" = "$script_root/ManagedLoopAcceptanceIosRuntime.ts" ] || exit 71
[ "$5" = download ] && [ "$6" = "$root/download-plan.json" ] || exit 71
[ "$TMPDIR" = "$root/tmp/" ] || exit 71
[ "$__UNSAFE_EXPO_HOME_DIRECTORY" = "$root/expo-home" ] || exit 71
[ -z "$TAO_DEV_LOOP_WORKER_CREDENTIALS" ] || exit 71
printf 'held %s %s\n' "$$" "$PPID"
IFS= read -r -t 10 acknowledgement || exit 70
[ "$acknowledgement" = "execute $generation" ] || exit 71
exec "$runtime" "$helper" download "$root/download-plan.json" > "$root/command-$generation-stdout.txt" 2> "$root/command-$generation-stderr.txt"
