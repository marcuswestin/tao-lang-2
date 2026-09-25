import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { summarizeDelegationLog } from '../agent-cli-src/delegation/DelegationLog'
import { DelegationReportCommand } from '../agent-cli-src/delegation/DelegationReportCommand'

function spawn(type: string): string {
  return JSON.stringify({
    event: 'spawn',
    time: '2026-09-24T16:00:00Z',
    payload: {
      tool_input: { subagent_type: type },
    },
  })
}

Describe('delegation report', () => {
  Test('reports an unknown selection without an inheritance warning', async () => {
    const summary = summarizeDelegationLog(spawn('unrecognized'))
    const output = await withCapturedOutput(() => DelegationReportCommand.write(summary, {}))
    Expect(output.stdout).toContain('unknown 1')
    Expect(output.stdout).not.toContain('inherited a deep or frontier model')
  })

  Test('keeps selection and observation separate without linking unrelated events', async () => {
    const summary = summarizeDelegationLog([
      spawn('Explore'),
      JSON.stringify({
        event: 'start',
        time: '2026-09-24T16:00:01Z',
        payload: {
          agent_id: 'a1',
          agent_type: 'Explore',
          model: 'claude-opus-5',
        },
      }),
    ].join('\n'))
    const output = await withCapturedOutput(() => DelegationReportCommand.write(summary, {}))
    Expect(output.stdout).toContain('inherited 1')
    Expect(output.stdout).toContain('claude-opus-5')
    Expect(output.stdout).not.toContain('inherited a deep or frontier model')
  })
})
