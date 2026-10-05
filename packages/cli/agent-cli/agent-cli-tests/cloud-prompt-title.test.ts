import { Describe, Expect, Test } from '@shared/test'
import { cloudPromptSubmitReport } from '../agent-cli-src/agent-hooks/CloudPromptTitleEntry'

Describe('cloud prompt title', () => {
  Test('prefixes a custom title that arrived after the session started', () => {
    Expect(JSON.parse(cloudPromptSubmitReport(JSON.stringify({ session_title: 'Rum tests', prompt: 'go' })))).toEqual({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: 'CLOUD: Rum tests' },
    })
  })

  Test('says nothing when the title is already prefixed, absent, or unreadable', () => {
    Expect(cloudPromptSubmitReport(JSON.stringify({ session_title: 'CLOUD: Rum tests' }))).toBe('')
    Expect(cloudPromptSubmitReport(JSON.stringify({ session_title: '  ' }))).toBe('')
    Expect(cloudPromptSubmitReport(JSON.stringify({ prompt: 'go' }))).toBe('')
    Expect(cloudPromptSubmitReport('not json')).toBe('')
    Expect(cloudPromptSubmitReport('')).toBe('')
  })
})
