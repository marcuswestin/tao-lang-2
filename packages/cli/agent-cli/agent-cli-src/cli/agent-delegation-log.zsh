#!/bin/zsh

# The delegation hooks for Claude Code and Codex, rendered into .claude/settings.json and
# .codex/hooks.json from .rulesync/hooks.jsonc. Each invocation writes one file under
# .artifacts/delegation/events/, which `./agent delegation-report` summarises while the repository
# calibrates its subagent routing — see the `delegation` skill.
#
# One file per event rather than appended lines, because the guidance this log exists to tune asks
# for three to five concurrent agents, so simultaneous hooks are the designed case and not an edge:
# a payload runs to kilobytes, zsh flushes one in several writes, and concurrent appends to a shared
# file interleave and destroy both records. Separate files cannot collide, and the write lands
# through a rename so a reader never sees a partial one.
#
# The script parses nothing: it timestamps the harness payload and stores it whole, because the two
# harnesses disagree about which fields a delegation event carries and the reader can afford to be
# tolerant where a hook on every Agent call cannot afford to be slow. It never fails a tool call.
# A PreToolUse hook that exits non-zero can block the call it precedes, so every path here exits 0
# and every write is best-effort; a lost event costs a row in a report.
emulate zsh
set -u

EVENT="${1:-unknown}"
SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h:h:h:h:h}"
EVENTS_DIR="$REPO_ROOT/.artifacts/delegation/events"

# Newlines are only formatting inside a JSON document: a newline within a string arrives escaped, so
# flattening the payload keeps the record on one line without corrupting it. Trailing whitespace goes
# with it, because the document's own closing newline becomes a space here and command substitution
# strips only newlines. The cap is generous rather than tight: a spawn payload carries the whole
# brief, truncating one stops it being JSON, and the reader drops what it cannot parse — so a mean
# cap would lose precisely the largest delegations, which are the ones worth counting.
payload="$(cat 2>/dev/null | tr '\n\r' '  ' | sed 's/[[:space:]]*$//')"
payload="${payload:0:64000}"
[[ -z "$payload" ]] && payload='{}'

mkdir -p "$EVENTS_DIR" 2>/dev/null || exit 0
now="$(date -u +%Y%m%dT%H%M%SZ)"
pending="$EVENTS_DIR/.pending-$$-$RANDOM"
printf '{"event":"%s","time":"%s","payload":%s}\n' \
  "$EVENT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$payload" > "$pending" 2>/dev/null \
  && mv -f "$pending" "$EVENTS_DIR/$now-$$-$RANDOM-$EVENT.json" 2>/dev/null
rm -f "$pending" 2>/dev/null

exit 0
