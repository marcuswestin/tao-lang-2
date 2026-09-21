import { writeLine } from '@shared/HCI'
import { readStdinText, runtimeProcess } from '@shared/Platform'
import { recordOverride } from './HookOverrides'
import { hookOverrideReason, refusalIgnoringOverride } from './OutputDiscipline'

/**
 * The PreToolUse entry the `agent-output-discipline.zsh` shim runs for the Bash tool. It reads the
 * pending tool call on stdin and refuses the commands whose cost a warning arrives too late to
 * prevent. Anything unexpected — no payload, no command, a shape neither harness documents —
 * prints nothing and lets the call run: a hook that cannot read its payload must be silent rather
 * than cautious, because what it failed to parse might not be a Bash call at all.
 *
 * A command carrying `# hook-ok: <reason>` runs, and the reason is logged rather than argued. The
 * harness tells the hook which directory the call runs in; without that the override still stands
 * and only its record is lost, which is the right way round for a rule that exists to be measured.
 */

type Payload = { cwd?: string; tool_input?: { command?: string } }

/** readPayload returns the harness payload, or undefined when it is not one this hook understands. */
function readPayload(payload: string): Payload | undefined {
  try {
    return JSON.parse(payload) as Payload
  } catch {
    return undefined
  }
}

/** outputDisciplineDecision returns the harness JSON for a payload, or '' when the command may run. */
export async function outputDisciplineDecision(payload: string): Promise<string> {
  const parsed = readPayload(payload)
  const command = parsed?.tool_input?.command
  if (command === undefined || command === '') {
    return ''
  }
  const refusal = refusalIgnoringOverride(command)
  if (refusal === undefined) {
    return ''
  }
  const reason = hookOverrideReason(command)
  if (reason !== undefined) {
    const root = parsed?.cwd ?? runtimeProcess.cwd()
    await recordOverride(root, { at: new Date().toISOString(), command, reason, refusal })
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
  const decision = await outputDisciplineDecision(await readStdinText())
  if (decision !== '') {
    writeLine(decision)
  }
}
