import { Describe, Expect, Test } from '@shared/test'
import type { TestLedgerRecord, TestLedgerStore } from '../verification-src/TestLedger'
import { type PlanShardsOptions, TestShards } from '../verification-src/TestShards'

/**
 * The shard count is arithmetic over two recorded measurements, so every expectation here is a
 * literal derived by hand from the two constants the module publishes — 4.0s per shard and a 8.0s
 * floor — and never a number recomputed from the code under test. A test that asked `planShards`
 * what `planShards` should answer would agree with any regression.
 */

/** A suite's startup, small enough that the target count rather than the cap decides. */
const SMALL_STARTUP_MS = 100

function plan(options: Partial<PlanShardsOptions> & Pick<PlanShardsOptions, 'files'>) {
  return TestShards.planShards({
    fileCostMs: new Map(),
    fixedMs: SMALL_STARTUP_MS,
    suite: 'demo',
    ...options,
  })
}

/** ledgerOf builds the per-test store `fileCostsFromLedger` reads, one record per entry. */
function ledgerOf(
  entries: readonly { durationMs?: number; file: string; name?: string; suite: string }[],
): TestLedgerStore {
  const tests: Record<string, TestLedgerRecord> = {}
  for (const [index, entry] of entries.entries()) {
    const name = entry.name ?? `test ${index}`
    const id = `${entry.suite}::${entry.file}::${name}`
    tests[id] = {
      durationMs: entry.durationMs,
      file: entry.file,
      fileIdentity: `identity-${entry.file}`,
      id,
      lastRunAt: '2026-01-01T00:00:00.000Z',
      name,
      outcome: 'passed',
      suite: entry.suite,
    }
  }
  return { tests, version: 1 }
}

function costsOf(entries: readonly { costMs: number; file: string }[]): Map<string, number> {
  return new Map(entries.map(entry => [entry.file, entry.costMs]))
}

function allFiles(shards: readonly (readonly string[])[]): string[] {
  return shards.flat().toSorted()
}

function shardHolding(shards: readonly (readonly string[])[], file: string): readonly string[] {
  return shards.find(shard => shard.includes(file)) ?? []
}

Describe('test shard counts', () => {
  Test('splits a suite well above the shard target into about one shard per target interval', () => {
    // 40.0s measured less 0.1s startup is 39.9s of test work; at the published 4.0s target that is
    // ten shards, and the startup cap for that ratio is far above ten.
    const files = Array.from({ length: 12 }, (_, index) => `packages/demo/demo-tests/f${index}.test.ts`)
    const result = plan({
      fileCostMs: costsOf(files.map(file => ({ costMs: 1_000, file }))),
      files,
      measuredMs: 40_000,
    })

    Expect(result.shards.length).toBe(10)
    Expect(result.shards.every(shard => shard.length > 0)).toBe(true)
    Expect(allFiles(result.shards)).toEqual(files.toSorted())
    Expect(result.reason).toContain('10 shards')
    Expect(result.reason).toContain('40.0s measured')
    Expect(result.reason).toContain('4.0s target')
  })

  Test('balances shards by recorded cost rather than by file count', () => {
    // 20.0s measured less 0.1s startup is 19.9s, which is five shards at the 4.0s target.
    const heavy = 'packages/demo/demo-tests/heavy.test.ts'
    const cheap = Array.from({ length: 9 }, (_, index) => `packages/demo/demo-tests/cheap-${index}.test.ts`)
    const result = plan({
      fileCostMs: costsOf([{ costMs: 10_000, file: heavy }, ...cheap.map(file => ({ costMs: 100, file }))]),
      files: [heavy, ...cheap],
      measuredMs: 20_000,
    })

    Expect(result.shards.length).toBe(5)
    Expect(allFiles(result.shards)).toEqual([heavy, ...cheap].toSorted())
    // One 10.0s file is more work than all nine 0.1s files together, so its shard runs it alone
    // while the cheap files pack two and three deep around it.
    Expect(shardHolding(result.shards, heavy)).toEqual([heavy])
    Expect(result.shards.map(shard => shard.length).toSorted()).toEqual([1, 2, 2, 2, 3])
  })

  Test('charges a file the ledger has never seen the mean of the ones it has', () => {
    const heavy = 'packages/demo/demo-tests/heavy.test.ts'
    const cheap = ['c1', 'c2', 'c3'].map(name => `packages/demo/demo-tests/${name}.test.ts`)
    const fresh = 'packages/demo/demo-tests/zz-fresh.test.ts'
    const known = [{ costMs: 8_000, file: heavy }, ...cheap.map(file => ({ costMs: 1_000, file }))]
    // 14.0s measured less 0.1s startup is 13.9s, which is three shards at the 4.0s target.
    const measuredMs = 14_000
    const files = [heavy, ...cheap, fresh]

    const unseen = plan({ fileCostMs: costsOf(known), files, measuredMs })
    // The mean of 8.0s, 1.0s, 1.0s and 1.0s is 2.75s. A file recorded at exactly that cost has to
    // pack identically, which pins both halves of the rule: an unseen file is not free, and it
    // cannot outweigh what the ledger has measured.
    const atTheMean = plan({
      fileCostMs: costsOf([...known, { costMs: 2_750, file: fresh }]),
      files,
      measuredMs,
    })
    const free = plan({ fileCostMs: costsOf([...known, { costMs: 0, file: fresh }]), files, measuredMs })

    Expect(unseen.shards).toEqual(atTheMean.shards)
    Expect(shardHolding(unseen.shards, fresh)).toEqual([fresh])
    // Charged nothing, the new file would be packed in beside a cheap one instead of standing on
    // its own, so the mean is what produced this packing.
    Expect(unseen.shards).not.toEqual(free.shards)
    Expect(shardHolding(free.shards, fresh).length).toBe(2)
  })

  Test('caps the count before a shard would be mostly startup', () => {
    const files = Array.from({ length: 8 }, (_, index) => `packages/demo/demo-tests/f${index}.test.ts`)
    // 14.0s measured less 6.0s startup is 8.0s of work: two shards at the 4.0s target, but 8.0s
    // split two ways is 4.0s of work per shard against 6.0s of startup each, so the cap allows one.
    const result = plan({ files, fixedMs: 6_000, measuredMs: 14_000 })

    Expect(result.shards.length).toBe(1)
    Expect(result.shards[0]).toEqual(files.toSorted())
    Expect(result.reason).toBe('14.0s measured, 6.0s startup: one shard pays least')
  })

  Test('places the startup cap where a shard stops doing more work than its own startup', () => {
    // 12.0s of work at 1.0s of startup: twelve shards each do 1.0s of work for 1.0s of startup, and
    // a thirteenth would spend more time starting than testing.
    Expect(TestShards.startupCap(12_000, 1_000)).toBe(12)
    // One millisecond below the crossover the twelfth shard no longer carries its own startup.
    Expect(TestShards.startupCap(11_999, 1_000)).toBe(11)
    Expect(TestShards.startupCap(100_000, 1_000)).toBe(100)
    // A suite with no measured startup has nothing to trade against, so nothing caps it.
    Expect(TestShards.startupCap(1_000, 0)).toBe(Number.MAX_SAFE_INTEGER)
    // The cap is never zero: a suite always runs in at least one process.
    Expect(TestShards.startupCap(10, 9_000)).toBe(1)
  })

  Test('keeps a cold, single-unit, short, or unshardable suite in one process under its own name', () => {
    const files = ['packages/demo/demo-tests/a.test.ts', 'packages/demo/demo-tests/b.test.ts']

    Expect(plan({ files }).shards.length).toBe(1)
    Expect(plan({ files }).reason).toBe('no recorded duration yet')
    Expect(plan({ files: [files[0]!], measuredMs: 40_000 }).reason).toBe('one unit')
    Expect(plan({ files: [files[0]!], measuredMs: 40_000 }).shards).toEqual([[files[0]!]])
    Expect(plan({ files, measuredMs: 40_000, shardable: false }).reason).toBe('declared unshardable')
    // A suite that stays whole still reports its files in path order, whatever order it got them in.
    Expect(plan({ files: [...files].reverse(), measuredMs: 40_000, shardable: false }).shards).toEqual([files])
    // One millisecond under twice the 4.0s target, a suite is already smaller than one shard.
    Expect(plan({ files, measuredMs: 7_999 }).reason).toBe('8.0s measured, under the 8.0s floor')
    Expect(plan({ files, measuredMs: 7_999 }).shards).toEqual([files])
    Expect(plan({ files, measuredMs: 8_000 }).shards.length).toBe(2)

    // A suite that stays one process is scheduled under its own name; only a split adds a suffix.
    Expect(TestShards.shardName('dev', 0, 1)).toBe('dev')
    Expect(TestShards.shardName('dev', 1, 3)).toBe('dev#2')
    Expect(TestShards.suiteOf('dev#2')).toBe('dev')
    Expect(TestShards.suiteOf('dev')).toBe('dev')
  })

  Test('plans the same shards twice, whatever order the files arrive in', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => `packages/demo/demo-tests/${name}.test.ts`)
    // Equal costs make the file-name tiebreak the only thing that can order the packing.
    const fileCostMs = costsOf(files.map(file => ({ costMs: 2_000, file })))
    // 18.0s measured less 0.1s startup is 17.9s, which is four shards at the 4.0s target.
    const first = TestShards.planShards({
      fileCostMs,
      files,
      fixedMs: SMALL_STARTUP_MS,
      measuredMs: 18_000,
      suite: 'demo',
    })
    const second = TestShards.planShards({
      fileCostMs,
      files: [...files].reverse(),
      fixedMs: SMALL_STARTUP_MS,
      measuredMs: 18_000,
      suite: 'demo',
    })

    Expect(first.shards.length).toBe(4)
    Expect(first.shards).toEqual(second.shards)
    Expect(first.reason).toBe(second.reason)
    // Pinned by hand: six equal files dealt longest-first onto the lightest shard, ties broken by
    // path. Nothing about the order — the input sort, the cost sort, or its tiebreak — can change
    // without this literal moving.
    Expect(first.shards).toEqual([
      ['packages/demo/demo-tests/a.test.ts', 'packages/demo/demo-tests/e.test.ts'],
      ['packages/demo/demo-tests/b.test.ts', 'packages/demo/demo-tests/f.test.ts'],
      ['packages/demo/demo-tests/c.test.ts'],
      ['packages/demo/demo-tests/d.test.ts'],
    ])
  })
})

Describe('per-file costs from the test ledger', () => {
  Test("sums one suite's recorded test durations per file and ignores every other suite", () => {
    const ledger = ledgerOf([
      { durationMs: 120, file: 'packages/dev/dev-tests/a.test.ts', name: 'one', suite: 'dev' },
      { durationMs: 80, file: 'packages/dev/dev-tests/a.test.ts', name: 'two', suite: 'dev' },
      { durationMs: 500, file: 'packages/dev/dev-tests/b.test.ts', name: 'one', suite: 'dev' },
      { durationMs: 999, file: 'packages/shared/shared-tests/c.test.ts', name: 'one', suite: 'shared' },
      { file: 'packages/dev/dev-tests/d.test.ts', name: 'unmeasured', suite: 'dev' },
    ])

    const costs = TestShards.fileCostsFromLedger(ledger, 'dev')

    Expect([...costs.entries()].toSorted()).toEqual([
      ['packages/dev/dev-tests/a.test.ts', 200],
      ['packages/dev/dev-tests/b.test.ts', 500],
    ])
    // A file whose tests have no recorded duration is unknown rather than free, which is what sends
    // it to the mean when the plan is packed.
    Expect(costs.has('packages/dev/dev-tests/d.test.ts')).toBe(false)
    Expect(TestShards.fileCostsFromLedger(ledger, 'shared').get('packages/shared/shared-tests/c.test.ts')).toBe(999)
  })
})
