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

  Test('runs the benchmark only from `bench`, never alongside a check or verify gate', async () => {
    // A benchmark that shares a machine with the other gates measures contention, not the
    // language service, so no verification lane may reach it however it is structured. The
    // regression guard these checks provide runs in every test lane instead, as the
    // `performance-checks` suite the test runner discovers (`test-runner.test.ts`).
    Expect(await justCommands('bench')).toContain('language-performance.ts')

    for (const lane of ['check', 'verify', 'full-verify']) {
      const laneCommands = await justCommands(lane)
      Expect(laneCommands).not.toContain('bench')
      Expect(laneCommands).not.toContain('language-performance')
    }
  }, 30_000)

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

/** justCommands returns the commands a lane would run, so the assertion is about behavior. */
async function justCommands(name: string): Promise<string> {
  const result = await CLI.run('just', { args: ['--dry-run', name], cwd: Repo.getRoot() })
  Expect(result.exitCode).toBe(0)
  return `${result.stdout}${result.stderr}`
}
