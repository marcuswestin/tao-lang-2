import { writeLine } from '@shared/HCI'
import { readStdinText } from '@shared/Platform'
import { prefixedTitle } from './CloudSessionTitleEntry'

/**
 * The UserPromptSubmit hook for cloud sessions: `agent-prompt-submit.zsh` runs it only when Claude Code
 * reports a remote session. A session started from the app is usually untitled when SessionStart runs,
 * so the title that arrives later is prefixed here on the next prompt. The harness passes
 * `session_title` only once the session has a custom title, which is the one this hook can see.
 */

/** cloudPromptSubmitReport returns the harness JSON that prefixes the session title, or '' when none is needed. */
export function cloudPromptSubmitReport(payload: string): string {
  let sessionTitle: unknown
  try {
    const parsed: unknown = JSON.parse(payload)
    sessionTitle = typeof parsed === 'object' && parsed !== null
      ? (parsed as { session_title?: unknown }).session_title
      : undefined
  } catch {
    return ''
  }
  const current = typeof sessionTitle === 'string' ? sessionTitle.trim() : ''
  const title = current === '' ? undefined : prefixedTitle(current)
  return title === undefined
    ? ''
    : JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: title } })
}

if (import.meta.main) {
  const report = cloudPromptSubmitReport(await readStdinText())
  if (report !== '') {
    writeLine(report)
  }
}
