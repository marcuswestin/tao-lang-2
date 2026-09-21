import { writeLine } from '@shared/HCI'
import { readStdinText } from '@shared/Platform'
import { outputDisciplineRefusal } from './OutputDiscipline'

/**
 * The PreToolUse entry the `agent-output-discipline.zsh` shim runs for the Bash tool. It reads the
 * pending tool call on stdin and refuses the commands that would pull a whole file or a whole patch
 * into context. Anything unexpected — no payload, no command, a shape neither harness documents —
 * prints nothing and lets the call run: a hook that cannot read its payload must be silent rather
 * than cautious, because what it failed to parse might not be a Bash call at all.
 */

/** readCommand returns the Bash command a harness payload carries, or undefined otherwise. */
function readCommand(payload: string): string | undefined {
  try {
    return (JSON.parse(payload) as { tool_input?: { command?: string } }).tool_input?.command
  } catch {
    return undefined
  }
}

/** outputDisciplineDecision returns the harness JSON for a payload, or '' when the command may run. */
export function outputDisciplineDecision(payload: string): string {
  const command = readCommand(payload)
  const refusal = command === undefined || command === '' ? undefined : outputDisciplineRefusal(command)
  if (refusal === undefined) {
    return ''
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: refusal,
    },
  })
}

if (import.meta.main) {
  const decision = outputDisciplineDecision(await readStdinText())
  if (decision !== '') {
    writeLine(decision)
  }
}
