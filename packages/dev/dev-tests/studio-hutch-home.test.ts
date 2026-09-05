import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { StudioHutchHome } from '../dev-src/studio/StudioHutchHome'

Describe('Studio isolated Hutch home', () => {
  Test('clones immutable assets while clearing copied project registrations', async () => {
    await withTemporaryRoot('clone', async root => {
      const sourceHome = FS.resolvePath('source-home', root)
      const targetHome = FS.resolvePath('target-home', root)
      await seedSourceHome(sourceHome)
      let copies = 0

      const prepared = await StudioHutchHome.prepare({
        copyHome: async (source, target) => {
          copies += 1
          await FS.copyDirectory(source, target)
        },
        sourceHome,
        targetHome,
      })

      Expect(prepared).toBe(targetHome)
      Expect(copies).toBe(1)
      Expect(await FS.readText(FS.resolvePath('releases/hutch/release.txt', targetHome))).toBe('immutable')
      Expect(await FS.listDir(FS.resolvePath('state/projects', targetHome))).toEqual([])
      Expect(await FS.listDir(FS.resolvePath('state/locks/projects', targetHome))).toEqual([])
      Expect(await FS.readJson(FS.resolvePath('state/store.json', targetHome))).toEqual({
        canonicalRoot: targetHome,
        kind: 'hutch-store',
        schemaVersion: 1,
      })
      Expect(await FS.isFile(FS.resolvePath('state/projects/foreign.json', sourceHome))).toBe(true)
    })
  })

  Test('reuses immutable assets but resets mutable registrations for every operation', async () => {
    await withTemporaryRoot('warm', async root => {
      const sourceHome = FS.resolvePath('source-home', root)
      const targetHome = FS.resolvePath('target-home', root)
      await seedSourceHome(sourceHome)
      let copies = 0
      const options = {
        copyHome: async (source: string, target: string) => {
          copies += 1
          await FS.copyDirectory(source, target)
        },
        sourceHome,
        targetHome,
      }
      await StudioHutchHome.prepare(options)
      await FS.writeText(FS.resolvePath('state/projects/interrupted.json', targetHome), 'stale')
      await FS.writeText(FS.resolvePath('state/locks/projects/interrupted.lock', targetHome), 'stale')

      await StudioHutchHome.prepare(options)

      Expect(copies).toBe(1)
      Expect(await FS.listDir(FS.resolvePath('state/projects', targetHome))).toEqual([])
      Expect(await FS.listDir(FS.resolvePath('state/locks/projects', targetHome))).toEqual([])
      Expect(await FS.readText(FS.resolvePath('releases/hutch/release.txt', targetHome))).toBe('immutable')
    })
  })

  Test('clears only the stopped generated project locks', async () => {
    await withTemporaryRoot('project-locks', async projectRoot => {
      const lockRoot = FS.resolvePath('.hutch/locks', projectRoot)
      await FS.writeText(FS.resolvePath('electrobun-build.lock', lockRoot), '')
      await FS.writeText(FS.resolvePath('electrobun-readers/reader.lease', lockRoot), '')
      await FS.writeText(FS.resolvePath('unrelated.lock', lockRoot), 'keep')

      await StudioHutchHome.clearStoppedProjectLocks(projectRoot)

      Expect(await FS.exists(FS.resolvePath('electrobun-build.lock', lockRoot))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('electrobun-readers', lockRoot))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('unrelated.lock', lockRoot))).toBe('keep')
    })
  })

  Test('cleans an interrupted clone before a successful retry', async () => {
    await withTemporaryRoot('retry', async root => {
      const sourceHome = FS.resolvePath('source-home', root)
      const targetHome = FS.resolvePath('target-home', root)
      await seedSourceHome(sourceHome)
      let attempt = 0
      const options = {
        copyHome: async (source: string, target: string) => {
          attempt += 1
          await FS.copyDirectory(source, target)
          if (attempt === 1) {
            Errors.throwUnexpected('Simulated interrupted copy.')
          }
        },
        sourceHome,
        targetHome,
      }

      await Expect(StudioHutchHome.prepare(options)).rejects.toThrow(
        `Could not prepare Tao Studio's isolated Hutch home at ${targetHome}.`,
      )
      await StudioHutchHome.prepare(options)

      Expect(attempt).toBe(2)
      Expect(await FS.readText(FS.resolvePath('releases/hutch/release.txt', targetHome))).toBe('immutable')
      const preparingPrefix = `${FS.basename(targetHome)}.preparing-`
      Expect((await FS.listDir(root)).filter(name => name.startsWith(preparingPrefix))).toEqual([])
    })
  })
})

async function withTemporaryRoot(
  label: string,
  testFunction: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkTestDir(`studio-hutch-home-${label}-`)
  try {
    await testFunction(root)
  } finally {
    await FS.remove(root)
  }
}

async function seedSourceHome(sourceHome: string): Promise<void> {
  await FS.writeText(FS.resolvePath('releases/hutch/release.txt', sourceHome), 'immutable')
  await FS.writeText(FS.resolvePath('state/projects/foreign.json', sourceHome), 'foreign')
  await FS.writeText(FS.resolvePath('state/locks/projects/foreign.lock', sourceHome), 'foreign')
  await FS.writeJson(FS.resolvePath('state/store.json', sourceHome), {
    canonicalRoot: sourceHome,
    kind: 'hutch-store',
    schemaVersion: 1,
  })
}
