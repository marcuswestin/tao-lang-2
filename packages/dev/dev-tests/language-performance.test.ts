import { CLI, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type LanguagePerformanceReport,
  parseIterations,
  renderLanguagePerformance,
  summarizeSamples,
} from '../dev-src/performance/language-performance'

Describe('language performance reporting', () => {
  Test('summarizes odd and even steady-state samples', () => {
    Expect(summarizeSamples([5, 1, 4, 2, 3])).toEqual({ medianMs: 3, p95Ms: 5 })
    Expect(summarizeSamples([4, 1, 3, 2])).toEqual({ medianMs: 2.5, p95Ms: 4 })
  })

  Test('parses a positive iteration count', () => {
    Expect(parseIterations(undefined)).toBe(10)
    Expect(parseIterations('7')).toBe(7)
    Expect(() => parseIterations('0')).toThrow('Performance iterations must be a positive integer')
    Expect(() => parseIterations('1.5')).toThrow('Performance iterations must be a positive integer')
  })

  Test('forwards default and explicit Just recipe iterations', async () => {
    const [defaultRun, explicitRun] = await Promise.all([
      dryRunPerformanceRecipe(),
      dryRunPerformanceRecipe('7'),
    ])

    Expect(defaultRun.exitCode).toBe(0)
    Expect(commandOutput(defaultRun)).toContain('language-performance.ts "10"')
    Expect(explicitRun.exitCode).toBe(0)
    Expect(commandOutput(explicitRun)).toContain('language-performance.ts "7"')
  }, 15_000)

  Test('renders fixture metadata, latency percentiles, and aggregate timing', () => {
    const report: LanguagePerformanceReport = {
      fixturePath: '/repo/Apps/WordFlower/1 - Current/WordFlower.tao',
      fixtureBytes: 22_759,
      fixtureLines: 583,
      iterations: 10,
      wallMs: 1_234,
      measuredMs: 1_111,
      results: [{
        stage: 'validate',
        strategy: 'session',
        coldMs: 100,
        samplesMs: [2, 3, 4],
        summary: { medianMs: 3, p95Ms: 4 },
      }],
    }

    const output = renderLanguagePerformance(report)
    Expect(output).toContain('583 lines, 22759 bytes')
    Expect(output).toContain('validate  session')
    Expect(output).toContain('cold')
    Expect(output).toContain('median')
    Expect(output).toContain('p95')
    Expect(output).toContain('wall 1.2s, measured sum 1.1s')
  })
})

async function dryRunPerformanceRecipe(iterations?: string): Promise<CLI.CommandResult> {
  return await CLI.run('just', {
    args: ['--dry-run', 'language-performance', ...(iterations === undefined ? [] : [iterations])],
    cwd: Repo.getRoot(),
  })
}

function commandOutput(result: CLI.CommandResult): string {
  return `${result.stdout}\n${result.stderr}`
}
