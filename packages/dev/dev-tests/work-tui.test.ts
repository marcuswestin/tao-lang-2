import { Describe, Expect, Test } from '@shared/test'
import { WorkGraph, type WorkState } from '../dev-src/repository-tests/WorkGraph'
import { WorkTUI } from '../dev-src/repository-tests/WorkTUI'

function state(name: string, needs: readonly string[] = [], status: WorkState['status'] = 'pending'): WorkState {
  return {
    ...WorkGraph.createState({ name, needs, run: { args: [], command: 'true' } }),
    status,
  }
}

Describe('work dashboard', () => {
  Test('collapses a dense dependency stall into its shared causal chain', () => {
    const states = [
      state('_fix-tao', [], 'running'),
      state('_compile-word-flower-app', ['_fix-tao']),
      ...Array.from({ length: 65 }, (_, index) => state(`test-${index}`, ['_compile-word-flower-app'])),
    ]

    Expect(WorkTUI.testing.dashboardSummaryText(states)).toBe(
      '66 nodes blocked on _fix-tao → _compile-word-flower-app',
    )
    // The summary takes one row from the grid, and the dense layout still keeps every node visible
    // by dropping output lines before it drops cards.
    const layout = WorkTUI.testing.dashboardLayout({ columns: 160, rows: 28 }, states.length, 2)
    Expect(layout.lineLimit).toBe(0)
    Expect(layout.columnsPerRow).toBeGreaterThan(1)
  })

  Test('explains non-dependency blockage instead of showing anonymous waiting cards', () => {
    const gui = state('studio-canary', [], 'running')
    gui.node.resources = ['gui']
    const native = state('studio-smoke-native')
    native.node.resources = ['gui']
    Expect(WorkTUI.testing.dashboardSummaryText([gui, native])).toBe('1 node blocked on resource gui')

    const machine = state('typecheck')
    machine.reason = 'waiting for machine capacity: another verification lane holds 17/18 slots'
    Expect(WorkTUI.testing.dashboardSummaryText([machine])).toBe(
      '1 node waiting for machine capacity: another verification lane holds 17/18 slots',
    )
  })
})
