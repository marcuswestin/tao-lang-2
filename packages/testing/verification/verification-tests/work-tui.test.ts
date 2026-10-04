import { Describe, Expect, Test } from '@shared/test'
import { TestNodes } from '../verification-src/TestNodes'
import { WorkGraph, type WorkState } from '../verification-src/WorkGraph'
import { WorkTUI } from '../verification-src/WorkTUI'

function state(name: string, needs: readonly string[] = [], status: WorkState['status'] = 'pending'): WorkState {
  return {
    ...WorkGraph.createState({ name, needs, run: { args: [], command: 'true' } }),
    status,
  }
}

function shard(
  group: string,
  number: number,
  status: WorkState['status'],
  options: { elapsedMs?: number; lines?: readonly string[]; reason?: string } = {},
): WorkState {
  const result = state(`${group}#${number}`, [], status)
  result.dashboardGroup = group
  result.elapsedMs = options.elapsedMs ?? 0
  result.lines = [...(options.lines ?? [])]
  result.reason = options.reason
  return result
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

  Test('names core ordering barriers without treating settled failures as waiting work', () => {
    const core = state('parser:core', [], 'running')
    const app = state('app')
    app.node.after = ['parser:core']
    Expect(WorkTUI.testing.dashboardSummaryText([core, app])).toBe('1 node blocked on parser:core → app')
    core.status = 'failed'
    Expect(WorkTUI.testing.dashboardSummaryText([core, app])).toBe('1 node waiting for local capacity')
  })

  Test('groups only explicitly marked shards and leaves names opaque', () => {
    const items = WorkTUI.testing.dashboardItems([
      shard('tao-apps', 1, 'running'),
      state('literal#1', [], 'running'),
      shard('tao-apps', 2, 'pending'),
      state('parser', [], 'passed'),
    ])

    Expect(items.map(item => item.key)).toEqual([
      'group:tao-apps',
      'node:literal#1',
      'node:parser',
    ])
    const grouped = items[0]
    Expect(grouped?.kind === 'group' ? grouped.states.map(item => item.name) : []).toEqual([
      'tao-apps#1',
      'tao-apps#2',
    ])
  })

  Test('shows one fixed-height suite card with failures and active shards first', () => {
    const items = WorkTUI.testing.dashboardItems([
      shard('tao-apps', 1, 'passed', { elapsedMs: 1_000 }),
      shard('tao-apps', 2, 'running', { elapsedMs: 2_000 }),
      shard('tao-apps', 3, 'failed', { elapsedMs: 3_000, lines: ['assertion failed'] }),
      shard('tao-apps', 4, 'pending', { reason: 'waiting for dependency' }),
    ])
    const item = items[0]!
    const column = WorkTUI.testing.dashboardColumn(item, 4)

    Expect(column.status).toBe('failed')
    Expect(column.title).toContain('#3 x tao-apps 2/4')
    Expect(column.lines).toEqual([
      '1 failed · 1 running · 1 waiting · 1 passed',
      '#3 x assertion failed',
      '#2 ... 2.0s',
      '#4 - waiting for dependency',
    ])
    // Even a zero-output dense card retains the failing shard's identity in its title.
    const longName = WorkTUI.testing.dashboardItems([shard('runtime-toolchain', 12, 'failed')])[0]!
    Expect(WorkTUI.testing.dashboardColumn(longName, 0).title.startsWith('#12 x runtime-toolchain')).toBe(true)
  })

  Test('keeps same-status shard rows in numeric plan order', () => {
    const items = WorkTUI.testing.dashboardItems([
      shard('tao-apps', 1, 'pending'),
      shard('tao-apps', 2, 'pending'),
      shard('tao-apps', 10, 'pending'),
    ])

    Expect(WorkTUI.testing.dashboardColumn(items[0]!, 4).lines).toEqual([
      '3 waiting',
      '#1 - 0ms',
      '#2 - 0ms',
      '#10 - 0ms',
    ])
  })

  Test('moves a suite card through failure, running, pending, passed, and skipped precedence', () => {
    const failed = shard('dev', 1, 'failed')
    const running = shard('dev', 2, 'running')
    const pending = shard('dev', 3, 'pending')
    const items = WorkTUI.testing.dashboardItems([failed, running, pending])
    const status = () => WorkTUI.testing.dashboardColumn(items[0]!, 1).status

    Expect(status()).toBe('failed')
    failed.status = 'passed'
    Expect(status()).toBe('running')
    running.status = 'passed'
    Expect(status()).toBe('pending')
    pending.status = 'skipped'
    Expect(status()).toBe('passed')
    failed.status = 'skipped'
    running.status = 'skipped'
    Expect(status()).toBe('skipped')
  })

  Test('test planning marks real multi-shard suites for dashboard grouping', () => {
    const suite = {
      buildProcess: (_nodeName: string, files: readonly string[]) => ({
        args: [],
        command: 'true',
        files,
      }),
      files: ['a.test.ts', 'b.test.ts'],
      name: 'example-suite',
    }
    const timings = {
      nodes: {
        'example-suite': {
          emaMs: 20_000,
          lastMs: 20_000,
          lastRunAt: '2026-09-20T00:00:00.000Z',
          samples: 1,
        },
      },
      version: 1 as const,
    }
    const { states } = TestNodes.build({
      ledger: { tests: {}, version: 1 },
      selected: [suite],
      timings,
    })

    Expect(states.map(item => item.name)).toEqual(['example-suite#1', 'example-suite#2'])
    Expect(states.map(item => item.dashboardGroup)).toEqual(['example-suite', 'example-suite'])
    Expect(WorkTUI.testing.dashboardItems(states)).toHaveLength(1)
  })

  Test('uses grouped card count for dense layout while the header summary keeps raw nodes', () => {
    const shards = Array.from({ length: 12 }, (_, index) => shard('tao-apps', index + 1, 'pending'))
    const rawLayout = WorkTUI.testing.dashboardLayout({ columns: 80, rows: 12 }, shards.length, 1)
    const items = WorkTUI.testing.dashboardItems(shards)
    const groupedLayout = WorkTUI.testing.dashboardLayout({ columns: 80, rows: 12 }, items.length, 1)

    Expect(items).toHaveLength(1)
    Expect(groupedLayout.lineLimit).toBeGreaterThan(rawLayout.lineLimit)
    Expect(WorkTUI.testing.dashboardSummaryText(shards)).toBe('12 nodes waiting for local capacity')
    Expect(WorkTUI.testing.headerText({ lane: 'verify', startedAt: Date.now(), states: shards })).toContain(
      '0/12 done, 0 running, 12 pending',
    )
  })
})
