import { FS, Platform, TaoHome } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { RuntimeToolchainPaths } from '../expo-host-src/runtime-toolchain-paths'
import { TestHarnessFiles } from '../expo-host-src/testing/test-harness-files'
import { TestRunRoot } from '../expo-host-src/testing/test-run-root'

const HOUR_MS = 60 * 60 * 1000

/** Keep an outside-checkout Tao home writable in the managed test sandbox. */
async function withIsolatedTaoHome(run: () => Promise<void>): Promise<void> {
  const fixture = await mkTestDir('tao-test-home-', { location: 'host' })
  const previous = Platform.runtimeProcess.env['TAO_HOME']
  Platform.runtimeProcess.env['TAO_HOME'] = FS.resolvePath('.tao', fixture)
  try {
    await run()
  } finally {
    if (previous === undefined) {
      delete Platform.runtimeProcess.env['TAO_HOME']
    } else {
      Platform.runtimeProcess.env['TAO_HOME'] = previous
    }
  }
}

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
 * SHARDS_IN_A_LANE is the former verification-lane width: before sharing one compiled corpus,
 * each of eight app scopes could publish its own fingerprint. Direct partial `tao test` calls may
 * still produce those distinct entries, so retention is tested across more than one scope.
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
 * compiledApp writes what the compiler leaves under a run root for one app — `App.tsx` beside the
 * files it reaches, by path relative to it — and interns it, returning the stable `App.tsx` path
 * the store hands back.
 */
async function compiledApp(
  runRoot: string,
  contents: { app: string; files: Record<string, string> },
): Promise<string> {
  const generatedRoot = FS.resolvePath(`app-${Math.random().toString(36).slice(2)}/_gen_tao-app`, runRoot)
  await FS.writeText(FS.resolvePath('App.tsx', generatedRoot), contents.app)
  for (const [relativePath, code] of Object.entries(contents.files)) {
    await FS.writeText(FS.resolvePath(relativePath, generatedRoot), code)
  }
  return await TestRunRoot.intern(runRoot, generatedRoot)
}

/** treeOf is the store entry an interned app's `modules` link resolves into. */
async function treeOf(appPath: string): Promise<string> {
  return FS.dirname(await FS.realPath(FS.resolvePath('modules', FS.dirname(appPath))))
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
  Test('the selected Tao home stores compiled apps outside the checkout', async () => {
    await withIsolatedTaoHome(async () => {
      const runRoot = await TestRunRoot.create('tao-test-command')
      const appPath = await compiledApp(runRoot, {
        app: 'export default function App() { return null }\n',
        files: { 'modules/probe.ts': 'export const probe = true\n' },
      })

      Expect(FS.pathIsWithin(runRoot, TaoHome.cacheRoot())).toBe(true)
      Expect(FS.pathIsWithin(runRoot, FS.resolvePath('tao-test-runs', FS.tmpdir()))).toBe(false)
      Expect(TestRunRoot.generatedRoot()).toBe(TestRunRoot.hostGeneratedRoot(RuntimeToolchainPaths.packageRoot))
      Expect(await FS.isFile(appPath)).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('modules/probe.ts', FS.dirname(appPath)))).toBe(true)
      await TestRunRoot.discard(runRoot)
      Expect(await FS.exists(runRoot)).toBe(false)
    })
  })

  Test('records ownership when the CLI passes the explicit host root', async () => {
    await withIsolatedTaoHome(async () => {
      const runtimePackageRoot = await mkTestDir('tao-test-explicit-host-root-')
      const generatedRoot = TestRunRoot.hostGeneratedRoot(runtimePackageRoot)
      const identityRoot = FS.dirname(generatedRoot)
      const runRoot = await TestRunRoot.create('tao-test-command', { runtimePackageRoot, generatedRoot })
      try {
        const owner = await FS.readJson<Record<string, unknown>>(
          FS.resolvePath(`${process.pid}.json`, FS.resolvePath('.owners', identityRoot)),
        )

        Expect(FS.pathIsWithin(runRoot, TaoHome.cacheRoot())).toBe(true)
        Expect(owner['pid']).toBe(process.pid)
        Expect(typeof owner['updatedAt']).toBe('string')
        Expect(owner['version']).toBe(1)
      } finally {
        await FS.remove(identityRoot)
        await FS.remove(runtimePackageRoot)
      }
    })
  })

  Test('bounds aggregate roots while preserving live, uncertain, and receipt-less identities', async () => {
    const aggregateRoot = await mkTestDir('tao-test-runs-aggregate-')
    const oldIdentity = FS.resolvePath('0000000000000001', aggregateRoot)
    const liveIdentity = FS.resolvePath('0000000000000002', aggregateRoot)
    const uncertainIdentity = FS.resolvePath('0000000000000003', aggregateRoot)
    const legacyIdentity = FS.resolvePath('0000000000000004', aggregateRoot)
    const oldGeneratedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, oldIdentity)
    const liveGeneratedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, liveIdentity)
    const uncertainGeneratedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, uncertainIdentity)
    const legacyGeneratedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, legacyIdentity)
    const recentIdentity = FS.resolvePath('0000000000000005', aggregateRoot)
    const recentGeneratedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, recentIdentity)
    const emptyIdentity = FS.resolvePath('0000000000000007', aggregateRoot)
    const emptyGeneratedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, emptyIdentity)
    const recentRun = FS.resolvePath(`tao-test-command/run-${Date.now() - 23 * HOUR_MS}-recent`, recentGeneratedRoot)
    const oldRun = FS.resolvePath(`tao-test-command/run-${Date.now() - 26 * HOUR_MS}-old`, oldGeneratedRoot)
    try {
      await FS.writeText(FS.resolvePath('output.ts', oldRun), 'old bytes')
      await FS.writeText(
        FS.resolvePath('output.ts', FS.resolvePath('tao-test-command/run-1-live', liveGeneratedRoot)),
        'live bytes',
      )
      await FS.writeText(
        FS.resolvePath('output.ts', FS.resolvePath('tao-test-command/run-1-uncertain', uncertainGeneratedRoot)),
        'uncertain bytes',
      )
      await FS.writeText(
        FS.resolvePath('output.ts', FS.resolvePath('tao-test-command/run-1-legacy', legacyGeneratedRoot)),
        'legacy bytes',
      )
      await FS.writeText(FS.resolvePath('output.ts', recentRun), 'recent handoff')
      await FS.writeText(
        FS.resolvePath('output.ts', FS.resolvePath('tao-test-command/run-1-empty', emptyGeneratedRoot)),
        'empty receipt root',
      )
      const oldOwners = FS.resolvePath('.owners', oldIdentity)
      const liveOwners = FS.resolvePath('.owners', liveIdentity)
      const uncertainOwners = FS.resolvePath('.owners', uncertainIdentity)
      const recentOwners = FS.resolvePath('.owners', recentIdentity)
      await FS.mkdir(FS.resolvePath('.owners', emptyIdentity))
      await FS.writeJson(FS.resolvePath('2147483647.json', oldOwners), {
        pid: 2147483647,
        updatedAt: new Date(Date.now() - 26 * HOUR_MS).toISOString(),
        version: 1,
      })
      await FS.writeJson(FS.resolvePath(`${process.pid}.json`, liveOwners), {
        pid: process.pid,
        updatedAt: new Date(Date.now() - 26 * HOUR_MS).toISOString(),
        version: 1,
      })
      await FS.writeJson(FS.resolvePath('2147483646.json', recentOwners), {
        pid: 2147483646,
        updatedAt: new Date(Date.now() - 23 * HOUR_MS).toISOString(),
        version: 1,
      })
      await FS.writeText(FS.resolvePath('interrupted.json.tmp', uncertainOwners), '{')
      const oldTime = Date.now() - 26 * HOUR_MS
      for (
        const path of [
          oldIdentity,
          FS.resolvePath('.owners', oldIdentity),
          FS.resolvePath('2147483647.json', oldOwners),
          FS.resolvePath('output.ts', oldRun),
        ]
      ) {
        await FS.setModifiedTimeMs(path, oldTime)
      }

      await Promise.all([
        TestRunRoot.pruneHostAggregate(aggregateRoot, undefined, 1, true),
        TestRunRoot.pruneHostAggregate(aggregateRoot, undefined, 1, true),
      ])

      Expect(await FS.exists(oldIdentity)).toBe(false)
      Expect(await FS.isDirectory(liveGeneratedRoot)).toBe(true)
      Expect(await FS.isDirectory(uncertainGeneratedRoot)).toBe(true)
      Expect(await FS.isDirectory(legacyGeneratedRoot)).toBe(true)
      Expect(await FS.isDirectory(recentGeneratedRoot)).toBe(true)
      Expect(await FS.isDirectory(emptyGeneratedRoot)).toBe(true)
    } finally {
      await FS.remove(aggregateRoot)
    }
  })

  Test('evicts an inactive aggregate identity when its file-count budget is spent', async () => {
    const aggregateRoot = await mkTestDir('tao-test-runs-file-budget-')
    const identityRoot = FS.resolvePath('0000000000000006', aggregateRoot)
    const generatedRoot = FS.resolvePath(TestRunRoot.DIRECTORY_NAME, identityRoot)
    const runRoot = FS.resolvePath(`tao-test-command/run-${Date.now() - 26 * HOUR_MS}-old`, generatedRoot)
    try {
      await FS.writeText(FS.resolvePath('first.ts', runRoot), 'one')
      await FS.writeText(FS.resolvePath('second.ts', runRoot), 'two')
      const ownerRoot = FS.resolvePath('.owners', identityRoot)
      const ownerPath = FS.resolvePath('2147483645.json', ownerRoot)
      await FS.writeJson(ownerPath, {
        pid: 2147483645,
        updatedAt: new Date(Date.now() - 26 * HOUR_MS).toISOString(),
        version: 1,
      })
      const oldTime = Date.now() - 26 * HOUR_MS
      await FS.setModifiedTimeMs(identityRoot, oldTime)
      await FS.setModifiedTimeMs(ownerPath, oldTime)
      await FS.setModifiedTimeMs(FS.resolvePath('first.ts', runRoot), oldTime)
      await FS.setModifiedTimeMs(FS.resolvePath('second.ts', runRoot), oldTime)

      await TestRunRoot.pruneHostAggregate(aggregateRoot, undefined, Number.MAX_SAFE_INTEGER, true, 1)

      Expect(await FS.exists(identityRoot)).toBe(false)
    } finally {
      await FS.remove(aggregateRoot)
    }
  })

  Test('uses an external generated root while preserving the runtime package identity', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const generatedRoot = await mkTestDir('tao-test-generated-root-')
      try {
        const options = { generatedRoot, runtimePackageRoot }
        const runRoot = await TestRunRoot.create('tao-test-command', options)
        await writeManifest(runRoot)

        Expect(FS.pathIsWithin(runRoot, generatedRoot)).toBe(true)
        Expect(await TestRunRoot.open('tao-test-command', runRoot, options)).toEqual({
          manifestPath: FS.resolvePath(TestRunRoot.MANIFEST_FILE_NAME, runRoot),
          runRoot,
        })
        Expect(await TestRunRoot.publish('tao-test-command', FINGERPRINT, runRoot, options)).toBe(true)
        Expect((await TestRunRoot.lookup('tao-test-command', FINGERPRINT, options))?.runRoot).toBe(runRoot)
        Expect(await TestRunRoot.open('tao-test-command', runRoot, { runtimePackageRoot })).toBeUndefined()
      } finally {
        await FS.remove(generatedRoot)
      }
    })
  })

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
      const output = { app: 'import "./modules/a"', files: { 'modules/a.tsx': 'export const a = 1' } }

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

      const first = await compiledApp(runRoot, { app: 'alone', files: {} })
      const again = await compiledApp(runRoot, { app: 'alone', files: {} })

      Expect(again).toBe(first)
      Expect(await FS.readText(first)).toBe('alone')
      Expect(await FS.exists(FS.resolvePath('modules', FS.dirname(first)))).toBe(false)
      Expect((await FS.listDir(storeRoot(runtimePackageRoot))).length).toBe(1)
    })
  })

  // Five of WordFlower's eight test apps compile to the same files byte for byte except `App.tsx`.
  // Everything but `App.tsx` is stored once as a tree and each app links to it entry by entry, so an
  // edit that changes the tree costs one re-transform of it rather than one per app — and a module
  // that imports `../../NavKinds`, as the compiled navigation module does, finds it in the tree,
  // because Jest resolves the link to its real path and the file at the tree's top is real there.
  Test('shares everything but App.tsx between apps, as one tree the app links into', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })
      const files = {
        'modules/a.tsx': 'export const a = 1',
        'modules/nested/b.tsx': "import '../../NavKinds'",
        'NavKinds.ts': 'export const kinds = []',
      }

      const one = await compiledApp(runRoot, { app: 'one', files })
      const two = await compiledApp(runRoot, { app: 'two', files })

      Expect(one).not.toBe(two)
      Expect(await treeOf(one)).toBe(await treeOf(two))
      Expect(FS.dirname(await treeOf(one))).toBe(storeRoot(runtimePackageRoot))
      Expect((await FS.listDir(storeRoot(runtimePackageRoot))).length).toBe(3)
      for (const name of ['modules', 'NavKinds.ts']) {
        Expect(await FS.isSymbolicLink(FS.resolvePath(name, FS.dirname(one)))).toBe(true)
      }
      // The path a module inside the tree resolves `../../NavKinds` against is the tree itself.
      Expect(await FS.isFile(FS.resolvePath('NavKinds.ts', await treeOf(one)))).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('modules/nested/b.tsx', await treeOf(one)))).toBe(true)
    })
  })

  Test('keeps the store entries a surviving run root names and prunes the rest once they are old', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const kept = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 9 * HOUR_MS)
      const named = await compiledApp(kept, { app: 'named', files: { 'modules/a.tsx': 'shared' } })
      await manifestNaming(kept, named)
      const scratch = await TestRunRoot.create('tao-test-command', { runtimePackageRoot })
      const oldOrphan = await compiledApp(scratch, { app: 'old orphan', files: { 'modules/a.tsx': 'orphaned' } })
      const youngOrphan = await compiledApp(scratch, { app: 'young orphan', files: { 'modules/a.tsx': 'shared' } })
      await TestRunRoot.discard(scratch, { runtimePackageRoot })
      const entryOf = (appPath: string) => FS.basename(FS.dirname(appPath))
      const orphanedTree = FS.basename(await treeOf(oldOrphan))
      for (const entry of [entryOf(oldOrphan), orphanedTree]) {
        await FS.setModifiedTimeMs(FS.resolvePath(entry, storeRoot(runtimePackageRoot)), Date.now() - 2 * HOUR_MS)
      }

      await TestRunRoot.prune({ runtimePackageRoot })

      const remaining = await FS.listDir(storeRoot(runtimePackageRoot))
      Expect(remaining).toContain(entryOf(named))
      Expect(remaining).toContain(FS.basename(await treeOf(named)))
      Expect(remaining).toContain(entryOf(youngOrphan))
      Expect(remaining).not.toContain(entryOf(oldOrphan))
      Expect(remaining).not.toContain(orphanedTree)
      Expect(await TestRunRoot.lookup('tao-test-command', FINGERPRINT, { runtimePackageRoot })).toBeDefined()
    })
  })

  Test('hands nothing back for a published run root whose compiled app is gone', async () => {
    await withRuntimePackageRoot(async runtimePackageRoot => {
      const runRoot = await publishedRunRoot(runtimePackageRoot, FINGERPRINT, 0)
      const appPath = await compiledApp(runRoot, { app: 'gone', files: { 'modules/a.tsx': 'x' } })
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
})
