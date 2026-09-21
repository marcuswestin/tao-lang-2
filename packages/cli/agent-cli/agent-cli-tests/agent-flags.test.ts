import { Describe, Expect, Test } from '@shared/test'
import { parseAgentFlags } from '../agent-cli-src/runner/AgentFlags'

Describe('agent flags', () => {
  Test('finds none of its own flags in an ordinary argument list', () => {
    Expect(parseAgentFlags(['--no-cache', 'packages/cli/dev-cli'])).toEqual({
      json: false,
      maxLines: undefined,
      rest: ['--no-cache', 'packages/cli/dev-cli'],
      verbose: false,
    })
  })

  Test('strips --verbose and --json wherever they sit, keeping the rest in order', () => {
    const flags = parseAgentFlags(['--verbose', 'packages/x', '--json', '--no-cache'])

    Expect(flags.verbose).toBe(true)
    Expect(flags.json).toBe(true)
    Expect(flags.rest).toEqual(['packages/x', '--no-cache'])
  })

  Test('reads --max-lines in both its space and equals forms', () => {
    Expect(parseAgentFlags(['--max-lines', '40']).maxLines).toBe(40)
    Expect(parseAgentFlags(['--max-lines=40']).maxLines).toBe(40)
    Expect(parseAgentFlags(['--max-lines', '40']).rest).toEqual([])
    Expect(parseAgentFlags(['--max-lines=40', 'x']).rest).toEqual(['x'])
  })

  Test('ignores a malformed --max-lines rather than crashing the run over it', () => {
    Expect(parseAgentFlags(['--max-lines', 'nope']).maxLines).toBeUndefined()
    Expect(parseAgentFlags(['--max-lines']).maxLines).toBeUndefined()
    Expect(parseAgentFlags(['--max-lines=0']).maxLines).toBeUndefined()
  })
})
