import { Describe, Expect, Test } from '@shared/test'
import { boundOutput, outputCategoryFor } from '../agent-cli-src/runner/OutputPolicy'

Describe('agent output policy', () => {
  Test('classifies a command whose output is the answer as a report, and everything else as a gate', () => {
    Expect(outputCategoryFor('help')).toBe('report')
    Expect(outputCategoryFor('board')).toBe('report')
    Expect(outputCategoryFor('doctor')).toBe('report')
    Expect(outputCategoryFor('verify')).toBe('gate')
    Expect(outputCategoryFor('test-file')).toBe('gate')
    Expect(outputCategoryFor('some-future-command')).toBe('gate')
  })

  Test('keeps a gate output under its budget untouched', () => {
    const output = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n')

    const bounded = boundOutput(output, 'gate', 'passed')

    Expect(bounded.elided).toBe(0)
    Expect(bounded.lines).toEqual(Array.from({ length: 10 }, (_, index) => `line ${index}`))
  })

  Test('keeps only the tail of a gate whose output runs past its budget, 25 on success and 40 on failure', () => {
    const output = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')

    const passed = boundOutput(output, 'gate', 'passed')
    const failed = boundOutput(output, 'gate', 'failed')

    Expect(passed.lines.length).toBe(25)
    Expect(passed.lines[0]).toBe('line 75')
    Expect(passed.elided).toBe(75)
    Expect(failed.lines.length).toBe(40)
    Expect(failed.lines[0]).toBe('line 60')
  })

  Test('keeps the head and tail of a report past its budget, with an elision line between them', () => {
    const output = Array.from({ length: 300 }, (_, index) => `line ${index}`).join('\n')

    const bounded = boundOutput(output, 'report', 'passed')

    Expect(bounded.lines.length).toBe(181)
    Expect(bounded.lines[0]).toBe('line 0')
    Expect(bounded.lines[119]).toBe('line 119')
    Expect(bounded.lines[120]).toBe('… and 120 more lines …')
    Expect(bounded.lines[121]).toBe('line 240')
    Expect(bounded.lines.at(-1)).toBe('line 299')
  })

  Test('lets --max-lines override the budget for either category', () => {
    const output = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')

    Expect(boundOutput(output, 'gate', 'passed', 10).lines.length).toBe(10)
    const report = boundOutput(output, 'report', 'passed', 30)
    Expect(report.lines.length).toBe(31)
    Expect(report.lines[19]).toBe('line 19')
  })

  Test('reports no lines at all for a command that printed nothing, not one empty line', () => {
    Expect(boundOutput('', 'gate', 'passed')).toEqual({ elided: 0, lines: [] })
    Expect(boundOutput('\n', 'gate', 'passed')).toEqual({ elided: 0, lines: [] })
  })

  Test('strips ANSI codes and hard-wraps a line so one long advisory cannot blow the budget', () => {
    const escaped = `[31m${'x'.repeat(500)}[0m`

    const bounded = boundOutput(escaped, 'gate', 'passed')

    Expect(bounded.lines.every(line => !line.includes(''))).toBe(true)
    Expect(bounded.lines.every(line => line.length <= 240)).toBe(true)
    Expect(bounded.lines.join('').length).toBe(500)
  })
})
