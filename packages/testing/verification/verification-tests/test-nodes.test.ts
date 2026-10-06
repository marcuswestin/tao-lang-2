import { Describe, Expect, Test } from '@shared/test'
import { GateCatalog } from '../verification-src/GateCatalog'
import type { TimingsStore } from '../verification-src/RunTimings'
import type { TestLedgerStore } from '../verification-src/TestLedger'
import { type SelectedSuite, TestNodes } from '../verification-src/TestNodes'

const STUDIO = 'ides/studio'
const RECEIPTS = 'packages/ides/studio/studio-tests/studio-preview-session.test.ts'
const SOURCES = 'packages/ides/studio/studio-tests/studio-preview-session-sources.test.ts'
const REST = 'packages/ides/studio/studio-tests/studio-rest.test.ts'
const PLAIN = 'fixture/plain'
const PLAIN_FILES = ['a', 'b', 'c', 'd'].map(name => `packages/fixture/plain/plain-tests/${name}.test.ts`)

function suite(name: string, files: readonly string[]): SelectedSuite {
  return { name, files, buildProcess: (_name, selected) => ({ command: 'unused', args: selected, files: selected }) }
}

function ledgerOf(suiteName: string, costs: Record<string, number>): TestLedgerStore {
  const tests = Object.fromEntries(
    Object.entries(costs).map(([file, durationMs]) => [`${suiteName}::${file}`, {
      durationMs,
      file,
      fileIdentity: 'seeded',
      id: `${suiteName}::${file}`,
      lastRunAt: '2026-10-05T00:00:00.000Z',
      name: 'seeded',
      outcome: 'passed' as const,
      suite: suiteName,
    }]),
  )
  return { tests, version: 1 }
}

function timingsOf(emaMs: Record<string, number>): TimingsStore {
  return {
    nodes: Object.fromEntries(
      Object.entries(emaMs).map((
        [name, ms],
      ) => [name, { emaMs: ms, lastMs: ms, lastRunAt: '2026-10-05T00:00:00.000Z', samples: 1 }]),
    ),
    version: 1,
  }
}

function fixedMsOf(suiteName: string): number {
  return GateCatalog.suiteTuning(suiteName).fixedMs ?? GateCatalog.BUN_SUITE_FIXED_MS
}

function estimates(plan: ReturnType<typeof TestNodes.build>): Map<string, number | undefined> {
  return new Map(plan.states.map(state => [state.name, state.expectedMs]))
}

Describe('test node weighting', () => {
  Test('a file partition weighs the ledger cost of its files, scaled to the suite total', () => {
    // The seed records the whole suite; the ledger says which files carry it. Before this, each
    // partition node was charged the whole suite, so ten partitions of a 180 s suite planned as 1,800 s.
    const fixedMs = fixedMsOf(STUDIO)
    const plan = TestNodes.build({
      ledger: ledgerOf(STUDIO, { [RECEIPTS]: 100_000, [SOURCES]: 20_000, [REST]: 20_000 }),
      timings: timingsOf({ [STUDIO]: fixedMs + 140_000 }),
      selected: [suite(STUDIO, [RECEIPTS, SOURCES, REST])],
    })

    const byName = estimates(plan)
    Expect(byName.get(`${STUDIO}:session-receipts`)).toBe(fixedMs + 100_000)
    Expect(byName.get(`${STUDIO}:session-sources`)).toBe(fixedMs + 20_000)
    const rest = plan.states.find(state => state.selectedTestFiles?.includes(REST))
    Expect(rest?.expectedMs).toBe(fixedMs + 20_000)
  })

  Test('a partition with its own history keeps it; a shard never does, because its membership moves', () => {
    const fixedMs = fixedMsOf(STUDIO)
    const partitioned = TestNodes.build({
      ledger: ledgerOf(STUDIO, { [RECEIPTS]: 100_000, [SOURCES]: 20_000 }),
      timings: timingsOf({ [STUDIO]: fixedMs + 120_000, [`${STUDIO}:session-receipts`]: 77_000 }),
      selected: [suite(STUDIO, [RECEIPTS, SOURCES])],
    })
    Expect(estimates(partitioned).get(`${STUDIO}:session-receipts`)).toBe(77_000)

    const fixedPlain = fixedMsOf(PLAIN)
    const costs = {
      [PLAIN_FILES[0]!]: 9_000,
      [PLAIN_FILES[1]!]: 9_000,
      [PLAIN_FILES[2]!]: 3_000,
      [PLAIN_FILES[3]!]: 3_000,
    }
    const sharded = TestNodes.build({
      ledger: ledgerOf(PLAIN, costs),
      timings: timingsOf({ [PLAIN]: fixedPlain + 48_000, [`${PLAIN}#1`]: 1, [`${PLAIN}#2`]: 1 }),
      selected: [suite(PLAIN, PLAIN_FILES)],
    })
    const shards = sharded.states.filter(state => state.name.startsWith(`${PLAIN}#`))
    Expect(shards.length).toBeGreaterThan(1)
    for (const shard of shards) {
      const shardCost = shard.selectedTestFiles!.reduce((total, file) => total + costs[file]!, 0)
      // The suite measured twice what the ledger sums to, so every shard is scaled by that ratio.
      Expect(shard.expectedMs).toBe(Math.round(fixedPlain + 48_000 * (shardCost / 24_000)))
    }
  })

  Test('without a ledger, nodes split the suite evenly; without a suite record, they sum their files', () => {
    const fixedMs = fixedMsOf(STUDIO)
    const evenly = TestNodes.build({
      ledger: { tests: {}, version: 1 },
      timings: timingsOf({ [STUDIO]: 90_000 }),
      selected: [suite(STUDIO, [RECEIPTS, SOURCES, REST])],
    })
    Expect([...estimates(evenly).values()]).toEqual([30_000, 30_000, 30_000])

    const summed = TestNodes.build({
      ledger: ledgerOf(STUDIO, { [RECEIPTS]: 100_000, [SOURCES]: 20_000 }),
      timings: { nodes: {}, version: 1 },
      selected: [suite(STUDIO, [RECEIPTS, SOURCES])],
    })
    Expect(estimates(summed).get(`${STUDIO}:session-receipts`)).toBe(fixedMs + 100_000)
    Expect(estimates(summed).get(`${STUDIO}:session-sources`)).toBe(fixedMs + 20_000)

    const cold = TestNodes.build({
      ledger: { tests: {}, version: 1 },
      timings: { nodes: {}, version: 1 },
      selected: [suite(STUDIO, [RECEIPTS])],
    })
    Expect(estimates(cold).get(`${STUDIO}:session-receipts`)).toBeUndefined()
  })

  Test('expectedMsFor answers for test nodes from the plan and for everything else from the store', () => {
    const plan = TestNodes.build({
      ledger: { tests: {}, version: 1 },
      timings: timingsOf({ [STUDIO]: 90_000, '_typecheck': 42_000 }),
      selected: [suite(STUDIO, [RECEIPTS, SOURCES, REST])],
    })
    const expectedMs = TestNodes.expectedMsFor(plan.states, timingsOf({ [STUDIO]: 90_000, '_typecheck': 42_000 }))

    Expect(expectedMs(`${STUDIO}:session-receipts`)).toBe(30_000)
    Expect(expectedMs('_typecheck')).toBe(42_000)
    Expect(expectedMs('never-ran')).toBeUndefined()
  })
})
