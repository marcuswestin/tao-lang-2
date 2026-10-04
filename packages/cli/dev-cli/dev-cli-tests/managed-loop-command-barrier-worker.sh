#!/bin/bash
# Fixed source-only worker: no executable, shell command, PID, or endpoint arguments.
case "$1" in short|escape) ;; *) exit 71 ;; esac
[ "$#" -eq 2 ] || exit 71
printf 'worker-ready %s %s\n' "$$" "$PPID"
# `read -t` is a Bash builtin, absent from Linux's dash /bin/sh; the supervisor runs this with Bash.
IFS= read -r -t 10 acknowledgement || exit 70
[ "$acknowledgement" = 'execute-source' ] || exit 71
exec bun "$(dirname "$0")/managed-loop-command-barrier-child.ts" "$1" "$2"
