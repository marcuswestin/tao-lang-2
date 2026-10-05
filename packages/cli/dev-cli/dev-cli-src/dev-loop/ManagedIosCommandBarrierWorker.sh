#!/bin/bash
# Repository-owned finite native worker. No executable, PID, shell command, or endpoint is accepted.
[ "$#" -ge 5 ] || exit 71
generation=$1
root=$2
shift 2
case "$generation" in *[!0-9a-fA-F-]*|'') exit 71 ;; esac
[ "${#generation}" -eq 36 ] || exit 71
[ "$1" = simctl ] || exit 71
case "$2" in
  create) [ "$#" -eq 5 ] || exit 71
    case "$3" in 'Tao Managed '*_1) ;; *) exit 71 ;; esac ;;
  install) [ "$#" -eq 4 ] || exit 71
    case "$4" in "$root"/expo-home/*) ;; *) exit 71 ;; esac ;;
  bootstatus) [ "$#" -eq 4 ] && [ "$4" = -b ] || exit 71 ;;
  boot|shutdown|delete) [ "$#" -eq 3 ] || exit 71 ;;
  *) exit 71 ;;
esac
if [ "$2" != create ]; then
  case "$3" in *[!0-9a-fA-F-]*|'') exit 71 ;; esac
  [ "${#3}" -eq 36 ] || exit 71
fi
printf 'held %s %s\n' "$$" "$PPID"
IFS= read -r -t 10 acknowledgement || exit 70
[ "$acknowledgement" = "execute $generation" ] || exit 71
# ACK replaces this same worker kernel; native streams never share the supervisor control channel.
exec /usr/bin/xcrun "$@" > "$root/command-$generation-stdout.txt" 2> "$root/command-$generation-stderr.txt"
