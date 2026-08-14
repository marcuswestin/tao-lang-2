import { FS, Repo } from '@shared'
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

  Test('declares the default and forwards Just recipe iterations', async () => {
    const justfile = await FS.readText(Repo.resolvePath('Justfile'))

    Expect(justfile).toContain('bench iterations="10":')
    Expect(justfile).toContain('language-performance.ts "{{ iterations }}"')
  })

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
