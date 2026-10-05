#!/bin/bash
# Fixed source-only command adapter; never executes simctl or the SDK downloader.
[ "$#" -eq 5 ] || exit 71
generation=$1
root=$2
mode=$3
runtime=$4
child=$5
case "$mode" in short|hold|nonzero|escape|metadata|fixed-result) ;; *) exit 71 ;; esac
case "$child" in */packages/cli/dev-cli/dev-cli-tests/ManagedIosCommandBarrierSourceChild.ts) ;; *) exit 71 ;; esac
printf 'held %s %s\n' "$$" "$PPID"
IFS= read -r -t 10 acknowledgement || exit 70
[ "$acknowledgement" = "execute $generation" ] || exit 71
exec "$runtime" "$child" "$mode" "$root" > "$root/command-$generation-stdout.txt" 2> "$root/command-$generation-stderr.txt"
