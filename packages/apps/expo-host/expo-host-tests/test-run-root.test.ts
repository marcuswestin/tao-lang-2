import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { TestHarnessFiles } from '../expo-host-src/testing/test-harness-files'
import { TestRunRoot } from '../expo-host-src/testing/test-run-root'

const HOUR_MS = 60 * 60 * 1000

/** withRuntimePackageRoot runs one test against a throwaway runtime package root. */
async function withRuntimePackageRoot(run: (runtimePackageRoot: string) => Promise<void>): Promise<void> {
  const runtimePackageRoot = await mkTestDir('tao-test-run-root-')
  try {
    await run(runtimePackageRoot)
  } finally {
    await FS.remove(runtimePackageRoot)
  }
}

/** writeRunRoot writes a run root whose id claims it was created `ageMs` ago. */
async function writeRunRoot(runtimePackageRoot: string, category: string, ageMs: number): Promise<string> {
  const name = `run-${Date.now() - ageMs}-${Math.random().toString(36).slice(2)}`
  const path = FS.resolvePath(
    [TestRunRoot.DIRECTORY_NAME, category, name].filter(Boolean).join('/'),
    runtimePackageRoot,
  )
  await FS.writeText(FS.resolvePath('App.tsx', path), '')
  return path
}

/** A fingerprint is any 16-to-128 hexadecimal digits; these stand for three different runs. */
const FINGERPRINT = 'a'.repeat(64)
const OTHER_FINGERPRINT = 'b'.repeat(64)
const THIRD_FINGERPRINT = 'c'.repeat(64)

/**
 * SHARDS_IN_A_LANE stands for one sharded suite's worth of fingerprints. A shard's set of test paths
 * is part of what a run is fingerprinted by, so each of them publishes an entry of its own. An
 * observed `tao-apps` lane ran four, and the shard planner's own startup cap allowed six on the
 * measured numbers; the count is derived per checkout from recorded durations, so it rises with the
 * corpus and no fixed retained count is large enough by construction.
 */
const SHARDS_IN_A_LANE = 8

/** shardFingerprint is the distinct fingerprint one shard of a sharded lane publishes under. */
function shardFingerprint(shard: number): string {
  return shard.toString(16).padStart(4, '0').repeat(16)
}

/** cacheEntryPath locates the index file one published fingerprint is recorded in. */
function cacheEntryPath(runtimePackageRoot: string, fingerprint: string): string {
  return FS.resolvePath(
    `${TestRunRoot.DIRECTORY_NAME}/tao-test-command/.cache/${fingerprint}.json`,
    runtimePackageRoot,
  )
}

/**
 * restampCacheEntry rewrites what an entry records about its own cost and last use, which is what
 * retention spends. Driving those from the index rather than from real megabytes and real elapsed
 * days is what lets a test reach the budget and the retention window at all.
 */
async function restampCacheEntry(
  runtimePackageRoot: string,
  fingerprint: string,
  changes: { bytes?: number; idleMs?: number },
): Promise<void> {
  const path = cacheEntryPath(runtimePackageRoot, fingerprint)
  const entry = await FS.readJson<Record<string, unknown>>(path)
  await FS.writeJson(path, {
    ...entry,
    ...changes.bytes === undefined ? {} : { bytes: changes.bytes },
    ...changes.idleMs === undefined ? {} : { usedAt: new Date(Date.now() - changes.idleMs).toISOString() },
  })
}

/** writeManifest gives a run root the manifest a reusable root must carry to be handed out. */
async function writeManifest(runRoot: string): Promise<string> {
  await FS.writeJson(FS.resolvePath(TestRunRoot.MANIFEST_FILE_NAME, runRoot), { files: [] })
  return runRoot
}

/** publishedRunRoot writes one aged run root and publishes it as compiled output to reuse. */
async function publishedRunRoot(runtimePackageRoot: string, fingerprint: string, ageMs: number): Promise<string> {
  const runRoot = await writeManifest(await writeRunRoot(runtimePackageRoot, 'tao-test-command', ageMs))
  Expect(await TestRunRoot.publish('tao-test-command', fingerprint, runRoot, { runtimePackageRoot })).toBe(true)
  return runRoot
}

/**
 * compiledApp writes what the compiler leaves under a run root for one app — `App.tsx` beside a
 * `modules` tree — and interns it, returning the stable `App.tsx` path the store hands back.
 */
async function compiledApp(
  runRoot: string,
  contents: { app: string; modules: Record<string, string> },
): Promise<string> {
  const generatedRoot = FS.resolvePath(`app-${Math.random().toString(36).slice(2)}/_gen_tao-app`, runRoot)
  await FS.writeText(FS.resolvePath('App.tsx', generatedRoot), contents.app)
  for (const [name, code] of Object.entries(contents.modules)) {
    await FS.writeText(FS.resolvePath(`modules/${name}`, generatedRoot), code)
  }
  return await TestRunRoot.intern(runRoot, generatedRoot)
}

/** manifestNaming gives a run root a manifest whose one check runs the app at `modulePath`. */
async function manifestNaming(runRoot: string, modulePath: string): Promise<string> {
  await FS.writeJson(FS.resolvePath(TestRunRoot.MANIFEST_FILE_NAME, runRoot), {
    files: [{ suites: [{ checks: [{ app: { modulePath } }] }] }],
  })
  return runRoot
}

function storeRoot(runtimePackageRoot: string): string {
  return FS.resolvePath(
    `${TestRunRoot.DIRECTORY_NAME}/tao-test-command/${TestRunRoot.COMPILED_STORE_DIRECTORY_NAME}`,
    runtimePackageRoot,
  )
}

async function listGenerated(runtimePackageRoot: string, relativePath = ''): Promise<string[]> {
  const path = FS.resolvePath([TestRunRoot.DIRECTORY_NAME, relativePath].filter(Boolean).join('/'), runtimePackageRoot)
  return await FS.isDirectory(path) ? await FS.listDir(path) : []
}

Describe('generated test run roots', () => {
  Test('creates a run root inside its category', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })

      Expect(await FS.isDirectory(runRoot)).toBe(true)
      Expect(FS.relativePath(runtimePackageRoot, runRoot)).toMatch(
        new RegExp(`^${TestRunRoot.DIRECTORY_NAME}/tao-test-command/run-\\d+-`),
      )
    })
  })

  Test('discards the run root a finished suite created', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })

      await TestRunRoot.discard(runRoot, { runtimePackageRoot })

      Expect(await FS.exists(runRoot)).toBe(false)
      Expect(await listGenerated(runtimePackageRoot, 'tao-test-command')).toEqual([])
    })
  })

  Test('refuses to discard anything that is not a run root', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const generatedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, runtimePackageRoot)
      const runRoot = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })

      for (const path of [generatedRoot, FS.dirname(runRoot), runtimePackageRoot, `${runRoot}/../../..`]) {
        await Expect(TestRunRoot.discard(path, { runtimePackageRoot })).rejects.toThrow(
          'not a _gen_tao-app-test run root',
        )
      }
      Expect(await FS.isDirectory(runRoot)).toBe(true)
    })
  })

  Test('refuses a run-root prefix with a foreign suffix', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const generatedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, runtimePackageRoot)
      const foreignRunRoot = FS.resolvePath(`tao-test-command/run-${Date.now()}-a-manual`, generatedRoot)
      await FS.writeText(FS.resolvePath('App.tsx', foreignRunRoot), 'kept')

      await Expect(TestRunRoot.discard(foreignRunRoot, { runtimePackageRoot })).rejects.toThrow(
        'not a _gen_tao-app-test run root',
      )
      await TestRunRoot.prune({ runtimePackageRoot })

      Expect(await FS.readText(FS.resolvePath('App.tsx', foreignRunRoot))).toBe('kept')
    })
  })

  // `discard` removes recursively, so the run-root name shape alone must not authorize it: an
  // identically shaped directory under someone else's runtime root is still someone else's.
  Test('refuses to discard a same-shaped run root outside the configured runtime root', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      await withRuntimePackageRoot(async otherPackageRoot => {
        const foreignRunRoot = await writeRunRoot(otherPackageRoot, 'tao-test-command', 0)

        for (const options of [{ runtimePackageRoot }, {}]) {
          await Expect(TestRunRoot.discard(foreignRunRoot, options)).rejects.toThrow(
            'not a _gen_tao-app-test run root under',
          )
        }
        Expect(await FS.isDirectory(foreignRunRoot)).toBe(true)

        // Naming the root it really belongs to still removes it, so the guard is not refusing everything.
        await TestRunRoot.discard(foreignRunRoot, { runtimePackageRoot: otherPackageRoot })

        Expect(await FS.exists(foreignRunRoot)).toBe(false)
      })
    })
  })

  Test('keeps only the newest finished run root in each category', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const oldest = await writeRunRoot(runtimePackageRoot, 'tao-test-command', 6 * HOUR_MS)
      const older = await writeRunRoot(runtimePackageRoot, 'tao-test-command', 4 * HOUR_MS)
      const newest = await writeRunRoot(runtimePackageRoot, 'tao-test-command', 2 * HOUR_MS)
      const otherCategory = await writeRunRoot(runtimePackageRoot, 'compile-app', 5 * HOUR_MS)

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect(await FS.exists(oldest)).toBe(false)
      Expect(await FS.exists(older)).toBe(false)
      Expect(await FS.exists(newest)).toBe(true)
      Expect(await FS.exists(otherCategory)).toBe(true)
    })
  })

  Test('never prunes a run root young enough to belong to a concurrent run', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const concurrent = [
        await writeRunRoot(runtimePackageRoot, 'tao-test-command', 0),
        await writeRunRoot(runtimePackageRoot, 'tao-test-command', 10 * 60 * 1000),
        await writeRunRoot(runtimePackageRoot, 'tao-test-command', 59 * 60 * 1000),
      ]
      const finished = await writeRunRoot(runtimePackageRoot, 'tao-test-command', 3 * HOUR_MS)
      const olderFinished = await writeRunRoot(runtimePackageRoot, 'tao-test-command', 9 * HOUR_MS)

      await TestRunRoot.prune({ runtimePackageRoot })

      for (const runRoot of concurrent) {
        Expect(await FS.exists(runRoot)).toBe(true)
      }
      Expect(await FS.exists(finished)).toBe(true)
      Expect(await FS.exists(olderFinished)).toBe(false)
    })
  })

  Test('prunes uncategorized run roots without reaching anything else', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const oldest = await writeRunRoot(runtimePackageRoot, '', 8 * HOUR_MS)
      const newest = await writeRunRoot(runtimePackageRoot, '', 3 * HOUR_MS)
      const generatedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, runtimePackageRoot)
      await FS.writeText(FS.resolvePath('notes.txt', generatedRoot), 'kept')
      await FS.writeText(FS.resolvePath('manual-scratch/App.tsx', generatedRoot), 'kept')

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect(await FS.exists(oldest)).toBe(false)
      Expect(await FS.exists(newest)).toBe(true)
      Expect(await listGenerated(runtimePackageRoot)).toContain('notes.txt')
      Expect(await listGenerated(runtimePackageRoot)).toContain('manual-scratch')
      Expect(await FS.isDirectory(runtimePackageRoot)).toBe(true)
    })
  })

  Test('prunes without failing when nothing has been generated yet', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      await TestRunRoot.prune({ runtimePackageRoot: FS.resolvePath('missing', runtimePackageRoot) })

      Expect(await listGenerated(runtimePackageRoot)).toEqual([])
    })
  })
})

Describe('reusing a generated test run root', () => {
  Test('hands a published run root back to a run with the same fingerprint', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)

      const found = await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })

      Expect(found?.runRoot).toBe(runRoot)
      Expect(found?.manifestPath).toBe(FS.resolvePath(TestRunRoot.MANIFEST_FILE_NAME, runRoot))
    })
  })

  Test('hands nothing back for a fingerprint nothing was published under', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)

      Expect(await TestRunRoot.lookup('tao-test-command', OTHER_FINGERPRINT, { runtimePackageRoot }))
        .toBeUndefined()
    })
  })

  // A run root without its manifest describes no run, however green the run that published it was.
  Test('hands nothing back once the published run root or its manifest is gone', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      await FS.remove(FS.resolvePath(TestRunRoot.MANIFEST_FILE_NAME, runRoot))

      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeUndefined()

      await writeManifest(runRoot)
      await FS.remove(runRoot)

      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeUndefined()
    })
  })

  Test('refuses to publish a run root with no manifest, or one it did not generate here', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      await withRuntimePackageRoot(async otherPackageRoot => {
        const withoutManifest = await writeRunRoot(runtimePackageRoot, 'tao-test-command', 0)
        const foreign = await writeManifest(await writeRunRoot(otherPackageRoot, 'tao-test-command', 0))
        const otherCategory = await writeManifest(await writeRunRoot(runtimePackageRoot, 'compile-app', 0))
        const uncategorized = await writeManifest(await writeRunRoot(runtimePackageRoot, '', 0))

        for (const candidate of [withoutManifest, foreign, otherCategory, uncategorized, runtimePackageRoot]) {
          Expect(await TestRunRoot.publish('tao-test-command', FINGERPRINT, candidate, { runtimePackageRoot }))
            .toBe(false)
        }
        Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeUndefined()
      })
    })
  })

  // Two runs that missed the same fingerprint at once must leave one cached root, not trade it:
  // the loser keeps an ordinary finished root, and the winner's root stays the one handed out.
  Test('leaves an already published run root in place rather than replacing it', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const first = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      const second = await writeManifest(await writeRunRoot(runtimePackageRoot, 'tao-test-command', 0))

      Expect(await TestRunRoot.publish('tao-test-command', FINGERPRINT, second, { runtimePackageRoot })).toBe(false)

      const found = await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })
      Expect(found?.runRoot).toBe(first)
    })
  })

  // Pruning keeps the newest finished root and drops the rest. A published root is not a finished
  // run's leftovers but the next identical run's input, so age must not reach it.
  Test('never prunes a published run root however old it is', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const published = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 9 * HOUR_MS)
      const newestFinished = await writeRunRoot(runtimePackageRoot, 'tao-test-command', 3 * HOUR_MS)
      const olderFinished = await writeRunRoot(runtimePackageRoot, 'tao-test-command', 6 * HOUR_MS)

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect(await FS.exists(published)).toBe(true)
      Expect(await FS.exists(newestFinished)).toBe(true)
      Expect(await FS.exists(olderFinished)).toBe(false)
      Expect((await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot }))?.runRoot)
        .toBe(published)
    })
  })

  // A root reused an hour after it was compiled is a root a concurrent run may be reading right
  // now. Once its entry is evicted, the grace has to run from the reuse, not from the compile.
  Test('keeps an evicted run root for the grace period after it was last handed out', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const published = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 9 * HOUR_MS)
      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeDefined()
      await FS.remove(FS.resolvePath(`${TestRunRoot.DIRECTORY_NAME}/tao-test-command/.cache`, runtimePackageRoot))
      // Two newer finished roots leave no retained slot for the evicted one; only its reuse does.
      await writeRunRoot(runtimePackageRoot, 'tao-test-command', 3 * HOUR_MS)
      await writeRunRoot(runtimePackageRoot, 'tao-test-command', 4 * HOUR_MS)

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect(await FS.exists(published)).toBe(true)
    })
  })

  Test('forgets an index entry whose run root no longer exists', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      await FS.remove(runRoot)

      await TestRunRoot.prune({ runtimePackageRoot })

      const cacheRoot = FS.resolvePath(`${TestRunRoot.DIRECTORY_NAME}/tao-test-command/.cache`, runtimePackageRoot)
      Expect(await FS.listDir(cacheRoot)).toEqual([])
    })
  })

  // The regression this retention policy exists for. A lane does not run a suite once: it shards it,
  // and every shard publishes an entry of its own, so a whole lane fills a small retained count by
  // itself. The developer's own `tao test Apps` — published before the lane and not touched by it —
  // was then the least recently used entry and the first evicted, and recompiled on every
  // invocation. Retaining four entries lost it the moment a lane ran more than three shards.
  Test('keeps a hand-run entry across a whole sharded lane', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const handRun = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      await restampCacheEntry(runtimePackageRoot, FINGERPRINT, { idleMs: 10 * 60 * 1000 })
      for (let shard = 0; shard < SHARDS_IN_A_LANE; shard += 1) {
        await publishedRunRoot(runtimePackageRoot, shardFingerprint(shard), 0)
      }

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect((await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot }))?.runRoot)
        .toBe(handRun)
      for (let shard = 0; shard < SHARDS_IN_A_LANE; shard += 1) {
        Expect(await TestRunRoot.lookup('tao-test-command', shardFingerprint(shard), { runtimePackageRoot }))
          .toBeDefined()
      }
    })
  })

  Test('records how much compiled output the run root it publishes holds', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await writeManifest(await writeRunRoot(runtimePackageRoot, 'tao-test-command', 0))
      await FS.writeText(FS.resolvePath('_gen_tao-app/App.tsx', runRoot), 'x'.repeat(4096))

      Expect(await TestRunRoot.publish('tao-test-command', FINGERPRINT, runRoot, { runtimePackageRoot })).toBe(true)

      const entry = await FS.readJson<Record<string, unknown>>(cacheEntryPath(runtimePackageRoot, FINGERPRINT))
      Expect(entry['bytes']).toBeGreaterThanOrEqual(4096)
    })
  })

  // Bytes are what the cache actually costs, so bytes are what bound it: entries leave in
  // least-recently-used order once the budget is spent, however few of them there are.
  Test('evicts the least recently used entries once the retained bytes are spent', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const half = Math.floor(TestRunRoot.RETAINED_CACHE_BYTES / 2)
      const newest = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      const older = await publishedRunRoot(runtimePackageRoot, OTHER_FINGERPRINT, 0)
      await publishedRunRoot(runtimePackageRoot, THIRD_FINGERPRINT, 0)
      await restampCacheEntry(runtimePackageRoot, FINGERPRINT, { bytes: half, idleMs: 60 * 1000 })
      await restampCacheEntry(runtimePackageRoot, OTHER_FINGERPRINT, { bytes: half, idleMs: 2 * 60 * 1000 })
      await restampCacheEntry(runtimePackageRoot, THIRD_FINGERPRINT, { bytes: half, idleMs: 3 * 60 * 1000 })

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect((await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot }))?.runRoot)
        .toBe(newest)
      Expect((await TestRunRoot.lookup('tao-test-command', OTHER_FINGERPRINT, { runtimePackageRoot }))?.runRoot)
        .toBe(older)
      Expect(await TestRunRoot.lookup('tao-test-command', THIRD_FINGERPRINT, { runtimePackageRoot }))
        .toBeUndefined()
    })
  })

  // A budget that evicted everything over it would make a corpus larger than the budget uncacheable:
  // each run would publish an entry the next prune removes, and no run would ever reuse anything.
  Test('keeps the most recently used entry even when it alone outgrows the budget', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      await restampCacheEntry(runtimePackageRoot, FINGERPRINT, { bytes: TestRunRoot.RETAINED_CACHE_BYTES * 4 })

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect((await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot }))?.runRoot)
        .toBe(runRoot)
    })
  })

  // Almost every entry here dies of a changed fingerprint rather than of eviction, so an entry
  // nothing has asked for in a retention window belongs to a generation nothing will ask for again.
  Test('forgets an entry no run has asked for within the retention window', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      await publishedRunRoot(runtimePackageRoot, OTHER_FINGERPRINT, 0)
      await restampCacheEntry(runtimePackageRoot, OTHER_FINGERPRINT, {
        idleMs: TestRunRoot.RETAINED_CACHE_AGE_MS + HOUR_MS,
      })

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeDefined()
      Expect(await TestRunRoot.lookup('tao-test-command', OTHER_FINGERPRINT, { runtimePackageRoot })).toBeUndefined()
    })
  })

  // Retention spends a recorded size, so an entry from a scheme that recorded none cannot be
  // budgeted. Treating it as absent costs one recompile and leaves the index consistent with itself.
  Test('forgets an entry that records no size for the budget to spend', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      const path = cacheEntryPath(runtimePackageRoot, FINGERPRINT)
      const { bytes: _unrecorded, ...previousScheme } = await FS.readJson<Record<string, unknown>>(path)
      await FS.writeJson(path, previousScheme)

      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeUndefined()

      await TestRunRoot.prune({ runtimePackageRoot })

      const cacheRoot = FS.resolvePath(`${TestRunRoot.DIRECTORY_NAME}/tao-test-command/.cache`, runtimePackageRoot)
      Expect(await FS.listDir(cacheRoot)).toEqual([])
    })
  })

  // Jest keys its transform cache by path, so a compiled app is stored by what it contains: the same
  // output compiled again, from another run root, is the same path and the same cache entry.
  Test('stores a compiled app by its contents and hands back one path for one output', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const first = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })
      const second = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })
      const output = { app: 'import "./modules/a"', modules: { 'a.tsx': 'export const a = 1' } }

      const firstPath = await compiledApp(first, output)
      const secondPath = await compiledApp(second, output)

      Expect(secondPath).toBe(firstPath)
      Expect(FS.dirname(FS.dirname(firstPath))).toBe(storeRoot(runtimePackageRoot))
      Expect(await FS.readText(firstPath)).toBe(output.app)
      Expect(await FS.readText(FS.resolvePath('modules/a.tsx', FS.dirname(firstPath)))).toBe('export const a = 1')
      // The run roots hold nothing of the compiled app any more; only what the run itself writes.
      Expect(await FS.listDir(first)).toEqual([])
      Expect(await FS.listDir(second)).toEqual([])
    })
  })

  // A fixture built of inline TSX reaches no module at all; it is stored whole, and stably.
  Test('stores an app that has no module tree', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })

      const first = await compiledApp(runRoot, { app: 'alone', modules: {} })
      const again = await compiledApp(runRoot, { app: 'alone', modules: {} })

      Expect(again).toBe(first)
      Expect(await FS.readText(first)).toBe('alone')
      Expect(await FS.exists(FS.resolvePath('modules', FS.dirname(first)))).toBe(false)
      Expect((await FS.listDir(storeRoot(runtimePackageRoot))).length).toBe(1)
    })
  })

  // Five of WordFlower's eight test apps compile to one module tree byte for byte; only `App.tsx`
  // differs. The tree is stored once and each app links to it, so an edit that changes the tree
  // costs one re-transform of it rather than one per app.
  Test('shares one module tree between apps that differ only in App.tsx', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })
      const modules = { 'a.tsx': 'export const a = 1', 'nested/b.tsx': 'export const b = 2' }

      const one = await compiledApp(runRoot, { app: 'one', modules })
      const two = await compiledApp(runRoot, { app: 'two', modules })

      Expect(one).not.toBe(two)
      const treeOf = async (appPath: string) => await FS.realPath(FS.resolvePath('modules', FS.dirname(appPath)))
      Expect(await treeOf(one)).toBe(await treeOf(two))
      Expect(FS.dirname(await treeOf(one))).toBe(storeRoot(runtimePackageRoot))
      Expect(await FS.isSymbolicLink(FS.resolvePath('modules', FS.dirname(one)))).toBe(true)
      Expect((await FS.listDir(storeRoot(runtimePackageRoot))).length).toBe(3)
    })
  })

  Test('keeps the store entries a surviving run root names and prunes the rest once they are old', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const kept = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 9 * HOUR_MS)
      const named = await compiledApp(kept, { app: 'named', modules: { 'a.tsx': 'shared' } })
      await manifestNaming(kept, named)
      const scratch = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })
      const oldOrphan = await compiledApp(scratch, { app: 'old orphan', modules: { 'a.tsx': 'orphaned' } })
      const youngOrphan = await compiledApp(scratch, { app: 'young orphan', modules: { 'a.tsx': 'shared' } })
      await TestRunRoot.discard(scratch, { runtimePackageRoot })
      const entryOf = (appPath: string) => FS.basename(FS.dirname(appPath))
      const treeOf = async (appPath: string) =>
        FS.basename(await FS.realPath(FS.resolvePath('modules', FS.dirname(appPath))))
      const orphanedTree = await treeOf(oldOrphan)
      for (const entry of [entryOf(oldOrphan), orphanedTree]) {
        await FS.setModifiedTimeMs(FS.resolvePath(entry, storeRoot(runtimePackageRoot)), Date.now() - 2 * HOUR_MS)
      }

      await TestRunRoot.prune({ runtimePackageRoot })

      const remaining = await FS.listDir(storeRoot(runtimePackageRoot))
      Expect(remaining).toContain(entryOf(named))
      Expect(remaining).toContain(await treeOf(named))
      Expect(remaining).toContain(entryOf(youngOrphan))
      Expect(remaining).not.toContain(entryOf(oldOrphan))
      Expect(remaining).not.toContain(orphanedTree)
      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeDefined()
    })
  })

  Test('hands nothing back for a published run root whose compiled app is gone', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      const appPath = await compiledApp(runRoot, { app: 'gone', modules: { 'a.tsx': 'x' } })
      await manifestNaming(runRoot, appPath)
      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeDefined()

      await FS.remove(FS.dirname(appPath))

      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeUndefined()
    })
  })

  // Entrypoint plans live beside the run roots so that Jest's configuration does not move from
  // compile to compile; a run rewrites the plan it uses, so one left alone for a week is unwanted.
  Test('retires an entrypoint plan no run has written in a week and keeps one in use', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      await writeRunRoot(runtimePackageRoot, 'tao-test-command', 0)
      const plansRoot = FS.resolvePath(
        `${TestRunRoot.DIRECTORY_NAME}/tao-test-command/${TestHarnessFiles.DIRECTORY_NAME}`,
        runtimePackageRoot,
      )
      const abandoned = FS.resolvePath('1-abandoned', plansRoot)
      await FS.writeText(FS.resolvePath('1-in-use/shard-1-of-1.jest.tsx', plansRoot), '')
      await FS.writeText(FS.resolvePath('shard-1-of-1.jest.tsx', abandoned), '')
      await FS.setModifiedTimeMs(abandoned, Date.now() - TestRunRoot.RETAINED_CACHE_AGE_MS - HOUR_MS)

      await TestRunRoot.prune({ runtimePackageRoot })

      Expect(await FS.listDir(plansRoot)).toEqual(['1-in-use'])
    })
  })

  // The index directory is named so that neither the run-root nor the category shape matches it.
  Test('never mistakes the index directory for generated code of its own', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 9 * HOUR_MS)

      await TestRunRoot.prune({ runtimePackageRoot })

      const cacheRoot = FS.resolvePath(`${TestRunRoot.DIRECTORY_NAME}/tao-test-command/.cache`, runtimePackageRoot)
      Expect(await FS.listDir(cacheRoot)).toEqual([`${FINGERPRINT}.json`])
    })
  })
})
