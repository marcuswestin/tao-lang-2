import { writeLine } from '@shared/HCI'
import { readStdinText } from '@shared/Platform'
import { subagentBrief } from './SubagentBrief'

/** The SubagentStart entry the `agent-subagent-brief.zsh` shim runs: it gives every subagent the
 * repository boilerplate the `delegation` skill otherwise asks each caller to paste into each
 * brief. The payload is read and discarded — the boilerplate is the same for every subagent, and
 * a hook that leaves stdin unread can hand the harness a broken pipe. */
export function subagentBriefReport(): string {
  return JSON.stringify({
    hookSpecificOutput: { additionalContext: subagentBrief(), hookEventName: 'SubagentStart' },
  })
}

if (import.meta.main) {
  await readStdinText()
  writeLine(subagentBriefReport())
}
