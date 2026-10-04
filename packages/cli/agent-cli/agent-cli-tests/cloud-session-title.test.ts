import { Describe, Expect, Test } from '@shared/test'
import { cloudSessionStartReport, prefixedTitle } from '../agent-cli-src/agent-hooks/CloudSessionTitleEntry'

function report(payload: Record<string, unknown>, notice = ''): Record<string, unknown> | undefined {
  const text = cloudSessionStartReport(JSON.stringify(payload), notice)
  return text === ''
    ? undefined
    : (JSON.parse(text) as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput
}

Describe('cloud session title', () => {
  Test('prefixes an existing title once', () => {
    Expect(prefixedTitle('Rum tests')).toBe('CLOUD: Rum tests')
    Expect(prefixedTitle('  Rum tests ')).toBe('CLOUD: Rum tests')
    Expect(prefixedTitle('CLOUD: Rum tests')).toBeUndefined()
    Expect(prefixedTitle('cloud:Rum tests')).toBeUndefined()
  })

  Test('sets the prefixed title on startup, resume, and fork', () => {
    for (const source of ['startup', 'resume', 'fork']) {
      Expect(report({ session_title: 'Rum tests', source })).toEqual({
        hookEventName: 'SessionStart',
        sessionTitle: 'CLOUD: Rum tests',
      })
    }
  })

  Test('leaves an already prefixed title alone and says nothing', () => {
    Expect(cloudSessionStartReport(JSON.stringify({ session_title: 'CLOUD: Rum tests', source: 'resume' }), ''))
      .toBe('')
  })

  Test('asks the agent to prefix a title the session does not have yet', () => {
    const output = report({ source: 'startup' })
    Expect(output?.['sessionTitle']).toBeUndefined()
    Expect(output?.['additionalContext']).toContain('set_session_title')
  })

  Test('changes nothing on clear or compact, where the harness ignores a title', () => {
    for (const source of ['clear', 'compact']) {
      Expect(cloudSessionStartReport(JSON.stringify({ session_title: 'Rum tests', source }), '')).toBe('')
      Expect(cloudSessionStartReport(JSON.stringify({ source }), '')).toBe('')
    }
  })

  Test('carries the model-routing notice as context beside the title', () => {
    Expect(report({ session_title: 'Rum tests', source: 'startup' }, 'routing notice\n')).toEqual({
      additionalContext: 'routing notice',
      hookEventName: 'SessionStart',
      sessionTitle: 'CLOUD: Rum tests',
    })
    Expect(report({ session_title: 'CLOUD: x', source: 'clear' }, 'routing notice')).toEqual({
      additionalContext: 'routing notice',
      hookEventName: 'SessionStart',
    })
  })

  Test('treats a missing or malformed payload as a session it cannot title', () => {
    Expect(cloudSessionStartReport('', '')).toBe('')
    Expect(cloudSessionStartReport('not json', 'routing notice')).toBe(
      JSON.stringify({ hookSpecificOutput: { additionalContext: 'routing notice', hookEventName: 'SessionStart' } }),
    )
  })
})
