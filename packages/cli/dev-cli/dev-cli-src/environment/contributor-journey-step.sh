#!/bin/sh
# One action of the contributor journey, run inside a disposable guest checkout by the Linux and
# macOS contributor proofs through their own timed step. It uses only the documented human
# commands (./dev dev-loop) and plain curl, so what it proves is what CONTRIBUTING.md tells a person.
set -eu

action=${1:-}
cd "$(dirname "$0")/../../../../.."
state=.artifacts/contributor-journey
starter=Apps/Starters/Notebook
app=Notebook
# One compiler line the journey adds, so the generated app visibly carries the contributor's change.
change_file=packages/compiler/compiler-src/codegen/react-native/app/FilesCompiler.ts
change_anchor='const useTaoGeneratedAgentCommands = TR.Agent.useCommands'
marker=contributor-journey-marker
change_line="      \${apps.length > 0 ? gen\`const __contributorJourney = \"$marker\"\` : gen.noop()}"
# Metro answers on the loop's URL once its status is ready; loops have no runtime timer of their own.
ready_attempts=450

mkdir -p "$state"

fail() {
  printf 'Contributor journey: %s\n' "$1" >&2
  exit 1
}

loop_start() {
  ./dev dev-loop start "$starter" --app "$app" --json > "$state/start.json"
  session=$(sed -n 's/.*"session":"\([0-9a-f-]*\)".*/\1/p' "$state/start.json" | head -n 1)
  [ -n "$session" ] || fail "the dev loop reported no session; see $state/start.json"
  printf '%s\n' "$session" > "$state/session"
  attempt=0
  while :; do
    ./dev dev-loop status --session "$session" --json > "$state/status.json"
    if grep -q '"state":"ready"' "$state/status.json"; then
      break
    fi
    if grep -q -e '"state":"failed"' -e '"state":"stopped"' "$state/status.json"; then
      fail "the dev loop stopped before it was ready; see $state/status.json"
    fi
    attempt=$((attempt + 1))
    [ "$attempt" -lt "$ready_attempts" ] || fail "the dev loop was not ready after $((ready_attempts * 2)) seconds"
    sleep 2
  done
  sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$state/status.json" | head -n 1 > "$state/url"
  [ -s "$state/url" ] || fail "the ready dev loop reported no URL; see $state/status.json"
  printf 'dev loop %s ready at %s\n' "$session" "$(cat "$state/url")"
}

loop_stop() {
  [ -s "$state/session" ] || return 0
  ./dev dev-loop stop --session "$(cat "$state/session")" --json > "$state/stop.json"
  rm -f "$state/session"
  printf 'dev loop stopped\n'
}

# Fetch the web page the loop serves, then the app bundle it names, and count the marker in it.
bundle_marker_count() {
  url=$(cat "$state/url")
  curl --fail --silent --show-error --max-time 60 "$url/" > "$state/index.html"
  script=$(sed -n 's/.*<script src="\([^"]*\)".*/\1/p' "$state/index.html" | head -n 1)
  [ -n "$script" ] || fail "the served page names no app bundle; see $state/index.html"
  curl --fail --silent --show-error --max-time 600 "$url$script" > "$state/bundle.js"
  grep -c "$marker" "$state/bundle.js" || true
}

case "$action" in
  loop-start) loop_start ;;
  loop-serve)
    count=$(bundle_marker_count)
    [ "$count" -eq 0 ] || fail "the untouched toolchain already serves $marker"
    printf 'served the Notebook web bundle without %s\n' "$marker"
    ;;
  toolchain-change)
    grep -q "$change_anchor" "$change_file" || fail "the compiler line to extend moved; update $0"
    if grep -q "$marker" "$change_file"; then
      fail "$change_file already carries the journey change"
    fi
    awk -v line="$change_line" -v anchor="$change_anchor" \
      '{ print } index($0, anchor) && !done { print line; done = 1 }' "$change_file" > "$state/changed.ts"
    cat "$state/changed.ts" > "$change_file"
    rm -f "$state/changed.ts"
    grep -q "$marker" "$change_file" || fail "the compiler change did not apply"
    printf 'edited %s\n' "$change_file"
    ;;
  loop-restart)
    loop_stop
    loop_start
    ;;
  loop-reflect)
    count=$(bundle_marker_count)
    [ "$count" -ge 1 ] || fail "the restarted loop does not serve the compiler change"
    printf 'the restarted loop serves the compiler change (%s occurrence)\n' "$count"
    ;;
  loop-stop) loop_stop ;;
  *) printf 'Usage: contributor-journey-step.sh loop-start|loop-serve|toolchain-change|loop-restart|loop-reflect|loop-stop\n' >&2; exit 2 ;;
esac
