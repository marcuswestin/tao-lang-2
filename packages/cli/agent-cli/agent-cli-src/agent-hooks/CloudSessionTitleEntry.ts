import { writeLine } from '@shared/HCI'
import { readStdinText, runtimeProcess } from '@shared/Platform'

/**
 * The cloud half of the SessionStart hook: `agent-session-start.zsh` runs it only when Claude Code
 * reports a remote session (`CLAUDE_CODE_REMOTE=true`), so every cloud session's title reads
 * `CLOUD: …` in the app's session list and local ones stay untouched. It reads the harness payload on
 * stdin and takes the model-routing notice as its one argument, because a hook that sets
 * `sessionTitle` must answer in JSON and the notice would otherwise be plain stdout beside it.
 */

const CLOUD_TITLE_PREFIX = 'CLOUD: '

/** Title changes apply on these sources; `clear` and `compact` ignore `sessionTitle`. */
const TITLED_SOURCES = new Set(['startup', 'resume', 'fork'])

/** Cloud sessions carry a title tool; a session that starts untitled is prefixed once it has one. */
const UNTITLED_NOTE = 'This is a cloud session and it has no title yet. Once it has one, rename it to start with '
  + `\`${CLOUD_TITLE_PREFIX}\`: read the current title with the remote session tool \`get_session\` and set `
  + `\`${CLOUD_TITLE_PREFIX}<that title>\` with \`set_session_title\`, unless it already starts with \`CLOUD:\`.`

type SessionStartPayload = { session_title?: unknown; source?: unknown }

function readPayload(payload: string): SessionStartPayload {
  try {
    const parsed: unknown = JSON.parse(payload)
    return typeof parsed === 'object' && parsed !== null ? parsed as SessionStartPayload : {}
  } catch {
    return {}
  }
}

/** prefixedTitle returns the cloud title for `title`, or undefined when it needs no change. */
export function prefixedTitle(title: string): string | undefined {
  const trimmed = title.trim()
  return /^CLOUD:/i.test(trimmed) ? undefined : `${CLOUD_TITLE_PREFIX}${trimmed}`
}

/** cloudSessionStartReport returns the harness JSON for a payload and notice, or '' when there is nothing to say. */
export function cloudSessionStartReport(payload: string, notice: string): string {
  const { session_title: sessionTitle, source } = readPayload(payload)
  const titled = typeof source === 'string' && TITLED_SOURCES.has(source)
  const current = typeof sessionTitle === 'string' ? sessionTitle.trim() : ''
  const title = titled && current !== '' ? prefixedTitle(current) : undefined
  const context = [notice.trim(), titled && current === '' ? UNTITLED_NOTE : ''].filter(line => line !== '')
  if (title === undefined && context.length === 0) {
    return ''
  }
  return JSON.stringify({
    hookSpecificOutput: {
      ...(context.length === 0 ? {} : { additionalContext: context.join('\n') }),
      hookEventName: 'SessionStart',
      ...(title === undefined ? {} : { sessionTitle: title }),
    },
  })
}

if (import.meta.main) {
  const report = cloudSessionStartReport(await readStdinText(), runtimeProcess.argv[2] ?? '')
  if (report !== '') {
    writeLine(report)
  }
}
