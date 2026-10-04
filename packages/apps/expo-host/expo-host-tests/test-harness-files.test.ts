import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import type * as TestCompiler from '../expo-host-src/testing/test-compiler/TestCompiler'
import { TestHarnessFiles } from '../expo-host-src/testing/test-harness-files'

/** A budget no plan in these tests can reach, for the cases that are about the other two ceilings. */
const UNBOUNDED = 1000

/** withRunRoot runs one test against a throwaway run root. */
async function withRunRoot(run: (runRoot: string) => Promise<void>): Promise<void> {
  const runRoot = await mkTestDir('tao-test-harness-files-')
  try {
    await run(runRoot)
  } finally {
    await FS.remove(runRoot)
  }
}

/** manifestOf builds a manifest of files named `A.test.tao`, `B.test.tao`, … with the given journeys. */
function manifestOf(journeysPerFile: readonly number[]): TestCompiler.Manifest {
  return {
    files: journeysPerFile.map((journeys, index) => ({
      sourcePath: `/projects/Demo/${String.fromCharCode(65 + index)}.test.tao`,
      suites: [{
        checks: Array.from({ length: journeys }, (_unused, check) => ({ name: `check ${check}` })),
        name: `Suite ${index}`,
      }],
    })) as TestCompiler.File[],
  }
}

/** oneShardPerWorker is the journey count that lets `count` shards clear the per-shard floor. */
function oneShardPerWorker(count: number): number[] {
  return Array.from({ length: count }, () => TestHarnessFiles.JOURNEYS_PER_SHARD)
}

/** writtenPlan reads back the entrypoints one plan generated, as file name to declared source paths. */
async function writtenPlan(directory: string): Promise<Map<string, string[]>> {
  const plan = new Map<string, string[]>()
  for (const name of (await FS.listDir(directory)).toSorted()) {
    const source = await FS.readText(FS.resolvePath(name, directory))
    plan.set(name, [...source.matchAll(/"([^"]+\.test\.tao)"/g)].map(match => match[1]!))
  }
  return plan
}

Describe('Tao test Jest entrypoints', () => {
  Test('gives each worker its own entrypoint so Jest has files to distribute', async () => {
    await withRunRoot(async runRoot => {
      const generated = await TestHarnessFiles.write(runRoot, manifestOf(oneShardPerWorker(4)), 4)

      Expect([...(await writtenPlan(generated.directory)).keys()]).toEqual([
        'shard-1-of-4.jest.tsx',
        'shard-2-of-4.jest.tsx',
        'shard-3-of-4.jest.tsx',
        'shard-4-of-4.jest.tsx',
      ])
    })
  })

  Test('declares every Tao test file exactly once across the plan', async () => {
    await withRunRoot(async runRoot => {
      const generated = await TestHarnessFiles.write(runRoot, manifestOf(oneShardPerWorker(6)), 3)
      const declared = [...(await writtenPlan(generated.directory)).values()].flat()

      Expect(generated.shardCount).toBe(3)
      Expect(declared.toSorted()).toEqual([
        '/projects/Demo/A.test.tao',
        '/projects/Demo/B.test.tao',
        '/projects/Demo/C.test.tao',
        '/projects/Demo/D.test.tao',
        '/projects/Demo/E.test.tao',
        '/projects/Demo/F.test.tao',
      ])
    })
  })

  // Jest hands one worker one file, so a shard that finishes early cannot take work off a shard that
  // is still running: what the plan puts in a shard is what that worker's wall time is.
  Test('balances the journeys across the plan rather than the files', async () => {
    await withRunRoot(async runRoot => {
      const generated = await TestHarnessFiles.write(runRoot, manifestOf([30, 20, 10, 10, 10]), 2)
      const shards = [...(await writtenPlan(generated.directory)).values()]

      // 30 + 10 against 20 + 10 + 10: one file each side, then the ties broken towards the first.
      Expect(shards).toEqual([
        ['/projects/Demo/A.test.tao', '/projects/Demo/D.test.tao'],
        ['/projects/Demo/B.test.tao', '/projects/Demo/C.test.tao', '/projects/Demo/E.test.tao'],
      ])
    })
  })

  Test('never plans more entrypoints than there are files to put in them', async () => {
    await withRunRoot(async runRoot => {
      const generated = await TestHarnessFiles.write(runRoot, manifestOf([100, 100]), UNBOUNDED)

      Expect(generated.shardCount).toBe(2)
    })
  })

  // An entrypoint costs its own module registry, so a run with little to divide is better off
  // undivided. This is the shape one app's own suite has, and it is the common one.
  Test('leaves a run with too little work to divide on one entrypoint', async () => {
    await withRunRoot(async runRoot => {
      const bulk = TestHarnessFiles.JOURNEYS_PER_SHARD * 2 - 2
      const small = await TestHarnessFiles.write(runRoot, manifestOf([1, 1, 1]), UNBOUNDED)
      // One journey short of two shards' worth, then exactly two shards' worth.
      const justUnder = await TestHarnessFiles.write(runRoot, manifestOf([bulk, 1]), UNBOUNDED)
      const justOver = await TestHarnessFiles.write(runRoot, manifestOf([bulk, 1, 1]), UNBOUNDED)

      Expect(small.shardCount).toBe(1)
      Expect(justUnder.shardCount).toBe(1)
      Expect(justOver.shardCount).toBe(2)
    })
  })

  // Jest fails a test file that holds no case, and such a file held none under the one
  // whole-manifest entrypoint this replaced either.
  Test('leaves a Tao test file that declares no journey out of the plan', async () => {
    await withRunRoot(async runRoot => {
      const generated = await TestHarnessFiles.write(runRoot, manifestOf([0, 2, 0]), UNBOUNDED)
      const declared = [...(await writtenPlan(generated.directory)).values()].flat()

      Expect(generated.shardCount).toBe(1)
      Expect(declared).toEqual(['/projects/Demo/B.test.tao'])
    })
  })

  Test('plans nothing for a manifest with no journey in it at all', async () => {
    await withRunRoot(async runRoot => {
      const generated = await TestHarnessFiles.write(runRoot, manifestOf([0, 0]), UNBOUNDED)

      Expect(generated.shardCount).toBe(0)
      Expect(await FS.isDirectory(generated.directory)).toBe(false)
    })
  })

  // A run root is reused by every later run that compiles to the same output, and those runs need
  // not want the same division of it.
  Test('keeps two runs dividing one run root differently out of each other’s way', async () => {
    await withRunRoot(async runRoot => {
      const manifest = manifestOf(oneShardPerWorker(4))
      const wide = await TestHarnessFiles.write(runRoot, manifest, 4)
      const snapshot = async () =>
        await Promise.all(
          (await FS.listDir(wide.directory)).toSorted().map(async name => [
            name,
            await FS.readText(FS.resolvePath(name, wide.directory)),
          ]),
        )
      const original = await snapshot()
      const narrow = await TestHarnessFiles.write(runRoot, manifest, 2)
      const named = await TestHarnessFiles.write(runRoot, manifestOf(oneShardPerWorker(2)), 2)
      const again = await TestHarnessFiles.write(runRoot, manifest, 4)

      Expect(new Set([wide.directory, narrow.directory, named.directory]).size).toBe(3)
      Expect(again.directory).toBe(wide.directory)
      Expect(await snapshot()).toEqual(original)
    })
  })

  Test('generates an entrypoint that names its harness and its own Tao test files', async () => {
    await withRunRoot(async runRoot => {
      const generated = await TestHarnessFiles.write(runRoot, manifestOf([2]), 1)
      const source = await FS.readText(FS.resolvePath('shard-1-of-1.jest.tsx', generated.directory))

      Expect(source).toContain(`import { declareTaoJourneys } from '${TestHarnessFiles.HARNESS_MODULE}'`)
      Expect(source).toContain('"/projects/Demo/A.test.tao"')
    })
  })
})
