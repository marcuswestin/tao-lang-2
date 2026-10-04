import { Describe, Expect, Test } from '@shared/test'
import { parseDevLoopArgs } from '../agent-cli-src/agent-config/DevLoopArgs'
import { hostCommandTarget } from '../agent-cli-src/agent-config/HostCommandTargets'

const session = '557d7e46-5b71-4289-85bc-8c9289a83616'

Describe('managed development loop public boundary', () => {
  Test('dispatches the public operation to its argument-guarded implementation', () => {
    Expect(hostCommandTarget(['dev-loop'])).toEqual({
      command: './dev',
      fixedArgs: ['dev-loop'],
      argsPolicy: 'dev-loop',
    })
    Expect(parseDevLoopArgs(['start', 'Apps/HNReader', '--app', 'HNReaderStub', '--web', '--json']))
      .toEqual({ kind: 'start', args: ['Apps/HNReader', '--app', 'HNReaderStub', '--web'], json: true })
    Expect(parseDevLoopArgs(['status', '--json'])).toEqual({ kind: 'status', json: true })
    Expect(parseDevLoopArgs(['start', '--web', 'Apps/HNReader', '--app', 'HNReaderStub']))
      .toEqual({ kind: 'start', args: ['Apps/HNReader', '--web', '--app', 'HNReaderStub'], json: false })
    Expect(parseDevLoopArgs(['logs', '--session', session])).toEqual({
      kind: 'logs',
      session,
      lines: 200,
      follow: false,
      json: false,
    })
    Expect(parseDevLoopArgs(['restart', '--session', session])).toEqual({ kind: 'restart', session, json: false })
  })

  Test('refuses private workers, arbitrary targets, unscoped visibility and ambiguous mutation selectors', () => {
    for (
      const args of [
        ['worker'],
        ['start', '--command', 'sh'],
        ['start', '--desktop'],
        ['start', '--device', 'personal'],
        ['start', '--show-browser'],
        ['start', '--show-emulator', '--ios'],
        ['start', '--simulator', session],
        ['stop'],
        ['stop', '--pid', '123'],
        ['stop', '--session', '../outside'],
        ['reload', '--session', session, '--show-browser'],
        ['stop', '--session', session, '--session', session],
        ['logs', '--session', session, '--json', '--follow'],
        ['logs', '--session', session, '--lines', '0'],
        ['start', '--app'],
        ['start', '--web', '--web'],
        ['start', '.', 'other'],
      ]
    ) {
      Expect(() => parseDevLoopArgs(args)).toThrow()
    }
  })
})
