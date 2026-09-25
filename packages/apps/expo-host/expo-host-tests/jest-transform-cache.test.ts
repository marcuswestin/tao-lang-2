import { Errors, FS, Platform } from '@shared'
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

  Test('managed cache follows an isolated TAO_HOME', async () => {
    await withCache(async parent => {
      const env = Platform.runtimeProcess.env
      const before = env['TAO_HOME']
      try {
        env['TAO_HOME'] = FS.resolvePath('home', parent)
        const root = JestTransformCache.root('/worktree/managed')
        Expect(root).toContain('/home/cache/jest-transform-cache-v2/')
        await JestTransformCache.run('/worktree/managed', async directory => {
          await FS.writeText(FS.resolvePath('transform', directory), 'cached')
        })
        Expect(await FS.readText(FS.resolvePath('data/transform', root))).toBe('cached')
      } finally {
        if (before === undefined) {
          delete env['TAO_HOME']
        } else {
          env['TAO_HOME'] = before
        }
      }
    })
  })

  Test('bounds inactive identities across worktrees while retaining the newest two', async () => {
    await withCache(async parent => {
      const names = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc']
      for (const name of names) {
        const root = FS.resolvePath(name, parent)
        await JestTransformCache.run(`/worktree/${name}`, async directory => {
          await FS.writeText(FS.resolvePath('transform', directory), name)
        }, { root, maxIdentities: 2, maxTotalFiles: 2, maxTotalBytes: 100 })
      }
      Expect(await FS.isDirectory(FS.resolvePath(names[0]!, parent))).toBe(false)
      Expect(await FS.isDirectory(FS.resolvePath(names[1]!, parent))).toBe(true)
      Expect(await FS.isDirectory(FS.resolvePath(names[2]!, parent))).toBe(true)
    })
  })

  Test('keeps a reader in another identity even when the aggregate budget is exceeded', async () => {
    await withCache(async parent => {
      const firstRoot = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      const secondRoot = FS.resolvePath('bbbbbbbbbbbbbbbb', parent)
      let release!: () => void
      let entered!: () => void
      const hold = new Promise<void>(resolve => {
        release = resolve
      })
      const ready = new Promise<void>(resolve => {
        entered = resolve
      })
      const first = JestTransformCache.run('/worktree/first', async directory => {
        await FS.writeText(FS.resolvePath('first', directory), 'one')
        entered()
        await hold
        Expect(await FS.isFile(FS.resolvePath('first', directory))).toBe(true)
      }, { root: firstRoot, maxIdentities: 1 })
      await ready
      await JestTransformCache.run('/worktree/second', async directory => {
        await FS.writeText(FS.resolvePath('second', directory), 'two')
      }, { root: secondRoot, maxIdentities: 1 })
      Expect(await FS.isDirectory(firstRoot)).toBe(true)
      release()
      await first
      Expect((await FS.listDir(parent)).filter(name => /^[0-9a-f]{16}$/.test(name)).length).toBe(1)
    })
  })

  Test('leaves an unreceipted identity alone', async () => {
    await withCache(async parent => {
      const unowned = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      await FS.writeText(FS.resolvePath('data/old', unowned), 'keep')
      const managed = FS.resolvePath('bbbbbbbbbbbbbbbb', parent)
      await JestTransformCache.run('/worktree/managed', async directory => {
        await FS.writeText(FS.resolvePath('new', directory), 'new')
      }, { root: managed, maxIdentities: 0, maxTotalFiles: 0, maxTotalBytes: 0 })
      Expect(await FS.isFile(FS.resolvePath('data/old', unowned))).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('data/new', managed))).toBe(true)
    })
  })

  Test('direct Jest uses a bounded cache lifecycle while the managed path keeps its own', () => {
    const env = Platform.runtimeProcess.env
    const before = env['TAO_TEST_JEST_CACHE_DIRECTORY']
    const { createRuntimeJestConfig } = require('../jest.shared.config.cjs') as {
      createRuntimeJestConfig: (options: { testMatch: string[] }) => {
        cacheDirectory: string
        globalSetup?: string
        globalTeardown?: string
      }
    }
    try {
      delete env['TAO_TEST_JEST_CACHE_DIRECTORY']
      const direct = createRuntimeJestConfig({ testMatch: [] })
      Expect(direct.cacheDirectory).toContain('jest-standalone-v2')
      Expect(direct.globalSetup).toContain('jest-direct-cache-setup.cjs')
      Expect(direct.globalTeardown).toContain('jest-direct-cache-teardown.cjs')
      env['TAO_TEST_JEST_CACHE_DIRECTORY'] = '/isolated/cache'
      const managed = createRuntimeJestConfig({ testMatch: [] })
      Expect(managed.cacheDirectory).toBe('/isolated/cache')
      Expect(managed.globalSetup).toBeUndefined()
    } finally {
      if (before === undefined) {
        delete env['TAO_TEST_JEST_CACHE_DIRECTORY']
      } else {
        env['TAO_TEST_JEST_CACHE_DIRECTORY'] = before
      }
    }
  })

  Test('direct Jest cache retains transforms until its last reader exits', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as {
        start: (root: string) => Promise<string>
        finish: (root: string, lease: string) => Promise<void>
      }
      const root = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      const first = await direct.start(root)
      const second = await direct.start(root)
      const transform = FS.resolvePath('data/transform', root)
      await FS.writeText(transform, 'hot')
      await direct.finish(root, first)
      Expect(await FS.isFile(transform)).toBe(true)
      await direct.finish(root, second)
      Expect(await FS.isFile(transform)).toBe(true)
      Expect(await FS.listDir(FS.resolvePath('leases', root))).toEqual([])
    })
  })

  Test('direct Jest retires inactive identities but preserves a live one', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as {
        start: (root: string) => Promise<string>
        finish: (root: string, lease: string) => Promise<void>
      }
      const identity = (index: number) => FS.resolvePath(index.toString(16).padStart(16, '0'), parent)
      const liveRoot = identity(0)
      const liveLease = await direct.start(liveRoot)
      await FS.writeText(FS.resolvePath('data/live', liveRoot), 'keep')
      for (let index = 1; index <= 16; index += 1) {
        const root = identity(index)
        const lease = await direct.start(root)
        await FS.writeText(FS.resolvePath('data/transform', root), 'one')
        await direct.finish(root, lease)
      }
      Expect(await FS.isFile(FS.resolvePath('data/live', liveRoot))).toBe(true)
      Expect(await FS.isDirectory(identity(1))).toBe(false)
      await direct.finish(liveRoot, liveLease)
    })
  })

  Test('direct Jest reclaims an interrupted lease after its child grace', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as {
        start: (root: string) => Promise<string>
        finish: (root: string, lease: string) => Promise<void>
      }
      const root = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      const initial = await direct.start(root)
      await direct.finish(root, initial)
      const dead = FS.resolvePath('leases/99999999-dead.json', root)
      await FS.writeText(dead, '{}')
      await FS.setModifiedTimeMs(dead, Date.now() - 2 * 60 * 60 * 1000)
      const next = await direct.start(root)
      Expect(await FS.exists(dead)).toBe(false)
      await direct.finish(root, next)
    })
  })

  Test('direct Jest relocates with TAO_HOME and keeps the single default home', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as {
        root: (runtimeRoot: string) => string
        start: (root: string) => Promise<string>
        finish: (root: string, lease: string) => Promise<void>
      }
      const env = Platform.runtimeProcess.env
      const before = { tao: env['TAO_HOME'], xdg: env['XDG_CACHE_HOME'], home: env['HOME'] }
      try {
        env['TAO_HOME'] = FS.resolvePath('home', parent)
        env['XDG_CACHE_HOME'] = FS.resolvePath('xdg', parent)
        env['HOME'] = FS.resolvePath('default-home', parent)
        const homeRoot = direct.root('/runtime/one')
        Expect(homeRoot).toContain('/home/cache/jest-standalone-v2/')
        const old = FS.resolvePath('home/cache/jest-standalone/old/data/transform', parent)
        await FS.writeText(old, 'legacy')
        const lease = await direct.start(homeRoot)
        await direct.finish(homeRoot, lease)
        Expect(await FS.readText(old)).toBe('legacy')
        delete env['TAO_HOME']
        Expect(direct.root('/runtime/one')).toContain('/default-home/.tao/cache/jest-standalone-v2/')
      } finally {
        if (before.tao === undefined) {
          delete env['TAO_HOME']
        } else {
          env['TAO_HOME'] = before.tao
        }
        if (before.xdg === undefined) {
          delete env['XDG_CACHE_HOME']
        } else {
          env['XDG_CACHE_HOME'] = before.xdg
        }
        if (before.home === undefined) {
          delete env['HOME']
        } else {
          env['HOME'] = before.home
        }
      }
    })
  })

  Test('direct Jest releases its lease after failed work', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as {
        start: (root: string) => Promise<string>
        finish: (root: string, lease: string) => Promise<void>
      }
      const root = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      const execute = async () => {
        const lease = await direct.start(root)
        try {
          Errors.throwHostEnvironment('test failed')
        } finally {
          await direct.finish(root, lease)
        }
      }
      await Expect(execute()).rejects.toThrow('test failed')
      Expect(await FS.listDir(FS.resolvePath('leases', root))).toEqual([])
    })
  })

  Test('direct Jest recovers a stale claim from a different lock inode', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as {
        start: (root: string, options?: { claimGraceMs: number }) => Promise<string>
        finish: (root: string, lease: string) => Promise<void>
      }
      const lock = FS.resolvePath('.coordination.lock', parent)
      const claim = `${lock}.reclaim`
      await FS.writeText(claim, JSON.stringify({ pid: 99999999, token: 'old' }))
      await FS.writeText(lock, JSON.stringify({ pid: 99999999, token: 'new' }))
      await FS.setModifiedTimeMs(lock, Date.now() - 2 * 60 * 60 * 1000)
      const root = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      const lease = await direct.start(root, { claimGraceMs: 0 })
      Expect(await FS.exists(claim)).toBe(false)
      await direct.finish(root, lease)
      Expect(await FS.exists(lock)).toBe(false)
    })
  })

  Test('direct Jest refuses symlinked cache data and preserves its target', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as {
        start: (root: string) => Promise<string>
        finish: (root: string, lease: string) => Promise<void>
      }
      const target = FS.resolvePath('unrelated', parent)
      await FS.writeText(FS.resolvePath('transform', target), 'keep')
      const unknown = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      await FS.mkdir(unknown)
      await FS.symlink(target, FS.resolvePath('data', unknown))
      await FS.writeText(FS.resolvePath('last-used', unknown), '1')
      const managed = FS.resolvePath('bbbbbbbbbbbbbbbb', parent)
      const lease = await direct.start(managed)
      await direct.finish(managed, lease)
      await Expect(direct.start(unknown)).rejects.toThrow('Refusing symlinked Jest cache data')
      Expect(await FS.readText(FS.resolvePath('transform', target))).toBe('keep')
      Expect(await FS.isSymbolicLink(FS.resolvePath('data', unknown))).toBe(true)
    })
  })

  Test('direct Jest refuses symlinked identity and parent paths', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as { start: (root: string) => Promise<string> }
      const target = FS.resolvePath('unrelated', parent)
      await FS.writeText(FS.resolvePath('transform', target), 'keep')
      const linkedIdentity = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      await FS.symlink(target, linkedIdentity)
      await Expect(direct.start(linkedIdentity)).rejects.toThrow('Refusing symlinked Jest cache path')
      const linkedParent = FS.resolvePath('linked-parent', parent)
      await FS.symlink(parent, linkedParent)
      await Expect(direct.start(FS.resolvePath('bbbbbbbbbbbbbbbb', linkedParent)))
        .rejects.toThrow('Refusing symlinked Jest cache path')
      Expect(await FS.readText(FS.resolvePath('transform', target))).toBe('keep')
      Expect(await FS.listDir(target)).toEqual(['transform'])
    })
  })

  Test('direct Jest recomputes a damaged negative size receipt', async () => {
    await withCache(async parent => {
      const direct = require('../jest-direct-cache.cjs') as {
        start: (root: string) => Promise<string>
        finish: (root: string, lease: string, options?: { maxTotalBytes: number }) => Promise<void>
      }
      const first = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      const firstLease = await direct.start(first)
      await FS.writeText(FS.resolvePath('data/transform', first), 'a'.repeat(10))
      await direct.finish(first, firstLease)
      await FS.writeJson(FS.resolvePath('size.json', first), { files: -100, bytes: -100 })
      const second = FS.resolvePath('bbbbbbbbbbbbbbbb', parent)
      const secondLease = await direct.start(second)
      await FS.writeText(FS.resolvePath('data/transform', second), 'b'.repeat(10))
      await direct.finish(second, secondLease, { maxTotalBytes: 15 })
      Expect(await FS.isDirectory(first)).toBe(false)
      Expect(await FS.isDirectory(second)).toBe(true)
    })
  })
})
