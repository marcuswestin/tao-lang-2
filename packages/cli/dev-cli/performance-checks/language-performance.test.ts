import { Describe, Expect, Test } from '@shared/test'
import {
  budgetBreaches,
  budgetFor,
  type LanguagePerformanceReport,
  parseIterations,
  renderLanguagePerformance,
  summarizeSamples,
} from '../dev-cli-src/performance/language-performance'

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
    Expect(output).toContain('budget')
    Expect(output).toContain('every steady-state median is within its budget')
  })

  // The bench fails on the median, not the cold call or the tail: the first call pays for module
  // loading and the tail for whatever else the machine was doing, and neither says the code got slower.
  Test('names every case whose steady-state median passed its budget, and only those', () => {
    const budgetMs = budgetFor('parse', 'session')
    const resultAt = (medianMs: number): LanguagePerformanceReport['results'][number] => ({
      stage: 'parse',
      strategy: 'session',
      coldMs: budgetMs * 10,
      samplesMs: [medianMs],
      summary: { medianMs, p95Ms: budgetMs * 10 },
    })
    const report = (medianMs: number): LanguagePerformanceReport => ({
      fixturePath: '/repo/App.tao',
      fixtureBytes: 1,
      fixtureLines: 1,
      iterations: 1,
      wallMs: 1,
      measuredMs: 1,
      results: [resultAt(medianMs)],
    })

    Expect(budgetBreaches(report(budgetMs))).toEqual([])
    Expect(budgetBreaches(report(budgetMs + 1))).toEqual([
      { budgetMs, medianMs: budgetMs + 1, stage: 'parse', strategy: 'session' },
    ])
    Expect(renderLanguagePerformance(report(budgetMs + 1))).toContain('over budget: parse session median')
  })
})
