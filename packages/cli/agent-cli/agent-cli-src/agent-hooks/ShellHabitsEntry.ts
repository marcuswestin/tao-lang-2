import { writeLine } from '@shared/HCI'
import { readStdinText } from '@shared/Platform'
import { shellHabitWarnings } from './ShellHabits'

/**
 * The PreToolUse entry the `agent-shell-habits.zsh` shim runs for the Bash tool. It reads the
 * pending tool call on stdin and states, beside the tool result, the shell habits this
 * repository's commands depend on. Anything unexpected — no payload, no command, a shape neither
 * harness documents — prints nothing, because a hook on every Bash call must cost nothing when it
 * has nothing to say. A narrow import graph keeps that cost low.
 */

/** readCommand returns the Bash command a harness payload carries, or undefined otherwise. */
function readCommand(payload: string): string | undefined {
  try {
    return (JSON.parse(payload) as { tool_input?: { command?: string } }).tool_input?.command
  } catch {
    return undefined
  }
}

/** shellHabitsReport returns the harness JSON for a payload, or '' when there is nothing to say. */
export function shellHabitsReport(payload: string): string {
  const command = readCommand(payload)
  const warnings = command === undefined || command === '' ? [] : shellHabitWarnings(command)
  if (warnings.length === 0) {
    return ''
  }
  return JSON.stringify({
    hookSpecificOutput: {
      additionalContext: `Tao worktree shell habits. ${warnings.join(' ')}`,
      hookEventName: 'PreToolUse',
    },
  })
}

if (import.meta.main) {
  const report = shellHabitsReport(await readStdinText())
  if (report !== '') {
    writeLine(report)
  }
}
