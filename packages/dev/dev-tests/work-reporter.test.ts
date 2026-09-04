import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { WorkGraph, type WorkState } from '../dev-src/repository-tests/WorkGraph'
import { WorkReporter } from '../dev-src/repository-tests/WorkReporter'

function nodeState(name: string, overrides: Partial<WorkState> = {}): WorkState {
  return {
    ...WorkGraph.createState({ name, run: { args: [], command: 'true' } }),
    ...overrides,
  }
}

async function quietOutput(states: readonly WorkState[]): Promise<string> {
  const captured = await withCapturedOutput(async () => {
    const reporter = WorkReporter.create({ lane: 'verify', logRoot: '/repo/.artifacts/logs/verify/now', mode: 'quiet' })
    reporter.handle({ kind: 'planned', states })
    for (const state of states) {
      if (state.status !== 'skipped') {
        reporter.handle({ kind: 'start', state })
      }
      reporter.handle({ kind: 'output', output: 'a very long line of gate output\n', state })
      reporter.handle({ kind: 'complete', state })
    }
    reporter.handle({ kind: 'done', interrupted: false, states })
    await reporter.finish()
  })
  return captured.stdout
}

Describe('output mode selection', () => {
  Test('an explicit mode wins over the pinned mode and over the terminal', () => {
    Expect(WorkReporter.resolveMode({ env: 'quiet', outputIsTerminal: true, requested: 'lines' })).toBe('lines')
  })

  Test('a pinned mode wins over the terminal, so a harness can fix what it gets', () => {
    Expect(WorkReporter.resolveMode({ env: 'lines', outputIsTerminal: true })).toBe('lines')
    Expect(WorkReporter.resolveMode({ env: '', outputIsTerminal: true })).toBe('tui')
  })

  Test('a terminal gets the dashboard and a pipe gets the agent contract', () => {
    Expect(WorkReporter.resolveMode({ outputIsTerminal: true })).toBe('tui')
    Expect(WorkReporter.resolveMode({ outputIsTerminal: false })).toBe('quiet')
  })

  Test('names where an unusable mode came from', () => {
    Expect(() => WorkReporter.resolveMode({ requested: 'dashboard' })).toThrow(
      "Unknown output mode 'dashboard' from --output",
    )
    Expect(() => WorkReporter.resolveMode({ env: 'dashboard', outputIsTerminal: false })).toThrow(
      'from TAO_OUTPUT_MODE',
    )
  })
})

Describe('quiet reporting', () => {
  Test('names the lane, its node count, and where the logs are, once', async () => {
    const output = await quietOutput([
      nodeState('_repo-lint', { elapsedMs: 1_200, logPath: '/repo/logs/repo-lint.log' }),
    ])

    Expect(output.split('\n')[0]).toContain('verify: running 1 node')
    Expect(output).toContain('.artifacts/logs/verify/now')
  })

  Test('never streams node output, and reports when each runnable node starts and completes', async () => {
    const startedAt = new Date(2026, 8, 4, 14, 3, 35).getTime()
    const output = await quietOutput([
      nodeState('_repo-lint', {
        elapsedMs: 1_200,
        logPath: '/repo/logs/repo-lint.log',
        startedAt,
        status: 'passed',
      }),
      nodeState('_typecheck', {
        elapsedMs: 400,
        logPath: '/repo/logs/typecheck.log',
        startedAt,
        status: 'failed',
      }),
      nodeState('_test', { reason: 'dependency failed: _typecheck', status: 'skipped' }),
    ])

    Expect(output).not.toContain('a very long line of gate output')
    Expect(output).toContain('_repo-lint: started at 14:03:35')
    Expect(output).toContain('_repo-lint: passed in 1.2s — log: ')
    Expect(output).toContain('_typecheck: started at 14:03:35')
    Expect(output).toContain('_typecheck: failed in 400ms — log: ')
    Expect(output).not.toContain('_test: started at')
    Expect(output).toContain('_test: skipped — dependency failed: _typecheck')
    // Header, start+complete for two runnable nodes, and only completion for the skipped node.
    Expect(output.trimEnd().split('\n').length).toBe(6)
  })
})
