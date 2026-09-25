import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { JestTransformCache } from '../expo-host-src/testing/jest-transform-cache'

async function withCache(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-jest-transform-cache-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
}

async function filesIn(directory: string): Promise<string[]> {
  const files: string[] = []
  for await (const path of FS.walk(directory)) {
    files.push(FS.relativePath(directory, path))
  }
  return files.sort()
}

Describe('Jest transform cache lifecycle', () => {
  Test('bounds repeated runs while reusing transforms that still fit', async () => {
    await withCache(async root => {
      const counts: number[] = []
      for (let run = 0; run < 8; run += 1) {
        await JestTransformCache.run(root, async directory => {
          if (!await FS.isFile(FS.resolvePath('shared', directory))) {
            await FS.writeText(FS.resolvePath('shared', directory), 'reused')
          }
          await FS.writeText(FS.resolvePath(`variant-${run}`, directory), 'one')
        }, { root, maxFiles: 4, maxBytes: 100 })
        counts.push((await filesIn(FS.resolvePath('data', root))).length)
      }
      Expect(counts).toEqual([2, 3, 4, 4, 4, 4, 4, 4])
      Expect(await filesIn(FS.resolvePath('data', root))).toContain('variant-7')
    })
  })

  Test('also bounds bytes when only a few large transforms are written', async () => {
    await withCache(async root => {
      await JestTransformCache.run(root, async directory => {
        await FS.writeText(FS.resolvePath('old', directory), 'a'.repeat(10))
        await FS.writeText(FS.resolvePath('new', directory), 'b'.repeat(10))
      }, { root, maxFiles: 10, maxBytes: 10 })
      Expect((await filesIn(FS.resolvePath('data', root))).length).toBe(1)
    })
  })

  Test('waits for every concurrent reader before pruning', async () => {
    await withCache(async root => {
      let releaseFirst!: () => void
      let enteredFirst!: () => void
      const firstEntered = new Promise<void>(resolve => {
        enteredFirst = resolve
      })
      const firstRelease = new Promise<void>(resolve => {
        releaseFirst = resolve
      })
      const first = JestTransformCache.run(root, async directory => {
        await FS.writeText(FS.resolvePath('first', directory), 'one')
        enteredFirst()
        await firstRelease
        Expect(await FS.isFile(FS.resolvePath('first', directory))).toBe(true)
      }, { root, maxFiles: 1 })
      await firstEntered
      await JestTransformCache.run(root, async directory => {
        await FS.writeText(FS.resolvePath('second', directory), 'two')
      }, { root, maxFiles: 1 })
      const beforeRelease = (await filesIn(FS.resolvePath('data', root))).length
      releaseFirst()
      await first
      Expect(beforeRelease).toBe(2)
      Expect((await filesIn(FS.resolvePath('data', root))).length).toBe(1)
    })
  })

  Test('reclaims an interrupted process lease on the next run', async () => {
    await withCache(async root => {
      await FS.writeText(FS.resolvePath('data/stale', root), 'old')
      const lease = FS.resolvePath('leases/99999999-dead.json', root)
      await FS.writeJson(lease, { pid: 99999999 })
      await FS.setModifiedTimeMs(lease, Date.now() - 2 * 60 * 60 * 1000)
      await JestTransformCache.run(root, async directory => {
        await FS.writeText(FS.resolvePath('fresh', directory), 'new')
      }, { root, maxFiles: 1 })
      Expect(await filesIn(FS.resolvePath('data', root))).toEqual(['fresh'])
      Expect(await FS.listDir(FS.resolvePath('leases', root))).toEqual([])
    })
  })

  Test('protects a recently orphaned Jest child until the lease grace ends', async () => {
    await withCache(async root => {
      const lease = FS.resolvePath('leases/99999999-abcd.json', root)
      await FS.writeText(FS.resolvePath('data/old', root), 'one')
      await FS.writeJson(lease, { pid: 99999999 })
      await JestTransformCache.run(root, async directory => {
        await FS.writeText(FS.resolvePath('new', directory), 'two')
      }, { root, maxFiles: 1 })
      Expect(await filesIn(FS.resolvePath('data', root))).toEqual(['new', 'old'])
      Expect(await FS.isFile(lease)).toBe(true)

      await FS.setModifiedTimeMs(lease, Date.now() - 2 * 60 * 60 * 1000)
      await JestTransformCache.run(root, async () => {}, { root, maxFiles: 1 })
      Expect((await filesIn(FS.resolvePath('data', root))).length).toBe(1)
      Expect(await FS.exists(lease)).toBe(false)
    })
  })

  Test('releases its lease and prunes after a failed run', async () => {
    await withCache(async root => {
      await Expect(JestTransformCache.run(root, async directory => {
        await FS.writeText(FS.resolvePath('first', directory), 'one')
        await FS.writeText(FS.resolvePath('second', directory), 'two')
        Errors.throwHostEnvironment('runner failed')
      }, { root, maxFiles: 1 })).rejects.toThrow('runner failed')
      Expect((await filesIn(FS.resolvePath('data', root))).length).toBe(1)
      Expect(await FS.listDir(FS.resolvePath('leases', root))).toEqual([])
    })
  })

  Test('keeps different runtime worktrees in different caches', () => {
    Expect(JestTransformCache.root('/worktree/one')).not.toBe(JestTransformCache.root('/worktree/two'))
    Expect(JestTransformCache.root('/worktree/one')).toBe(JestTransformCache.root('/worktree/one'))
  })
})
