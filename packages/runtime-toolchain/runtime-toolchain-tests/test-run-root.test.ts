import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { TestRunRoot } from '../runtime-toolchain-src/testing/test-run-root'

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
