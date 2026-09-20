import { Describe, Expect, fakeTerminal, Test } from '@shared/test'
import { DashboardGrid } from '../dev-src/cli/DashboardGrid'
import { OutputText } from '../dev-src/cli/OutputText'
import { WorkGraph, type WorkState } from '../dev-src/repository-tests/WorkGraph'
import { WorkTUI } from '../dev-src/repository-tests/WorkTUI'

function state(name: string, overrides: Partial<WorkState> = {}): WorkState {
  return {
    ...WorkGraph.createState({ name, run: { args: [], command: 'true' } }),
    ...overrides,
  }
}

async function renderedDashboard(states: readonly WorkState[]): Promise<string> {
  const terminal = fakeTerminal()
  const output = Object.assign(terminal.output, { columns: 160, rows: 28 })
  const reporter = WorkTUI.createReporter({
    lane: 'verify',
    terminal: {
      stderr: output as unknown as NodeJS.WriteStream,
      stdin: terminal.input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  })
  reporter.handle({ kind: 'planned', states })
  await reporter.finish()
  return OutputText.stripAnsi(terminal.outputText())
}

Describe('WorkTUI dashboard blockage summary', () => {
  Test('renders one dependency bottleneck for dense blank tiles', async () => {
    const fix = state('_fix-tao', { status: 'running' })
    const compile = state('_compile-word-flower-app', {
      node: { ...state('_compile-word-flower-app').node, needs: ['_fix-tao'] },
    })
    const tests = Array.from({ length: 65 }, (_, index) =>
      state(`test-${index}`, {
        node: { ...state(`test-${index}`).node, needs: ['_compile-word-flower-app'] },
      }))
    const states = [fix, compile, ...tests]

    Expect(WorkTUI.dashboardSummaryText(states)).toBe(
      '66 nodes blocked on _fix-tao → _compile-word-flower-app',
    )

    const layout = WorkTUI.dashboardLayout({ columns: 160, rows: 28 }, states.length, 2)
    Expect(DashboardGrid.layoutHeight(layout, states.length)).toBeLessThanOrEqual(25)

    const frame = (await renderedDashboard(states)).split('\n\nverify:')[0]!
    Expect(frame).toContain('66 nodes blocked on _fix-tao → _compile-word-flower-app')
    Expect(frame).toContain('test-64')
    Expect(frame.trimEnd().split('\n').length).toBe(26)
  })

  Test('skips passed and missing dependencies before reporting current resource admission', () => {
    const owner = state('native', {
      node: { ...state('native').node, resources: ['gui'] },
      status: 'running',
    })
    const waiter = state('canary', {
      node: { ...state('canary').node, needs: ['passed', 'missing'], resources: ['gui'] },
    })
    const passed = state('passed', { status: 'passed' })

    Expect(WorkTUI.dashboardSummaryText([owner, waiter, passed])).toBe('1 node waiting for resource gui')
  })
})
