import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { GreenTree, type GreenTreeKey, type GreenTreeRecord } from '../verification-src/GreenTree'

/**
 * The shared store is what lets a gate proved in one worktree, or on one CI machine, go unrun in
 * another at the same bytes. Each test is about something a per-checkout record could not do, or
 * something sharing must never do.
 */

const TOOLCHAIN = '/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-devenv-profile'

function keyFor(treeHash: string, toolchain = TOOLCHAIN): GreenTreeKey {
  return { toolchain, treeHash }
}

function entryFor(treeHash: string, logRoot: string, toolchain = TOOLCHAIN): GreenTreeRecord {
  return { at: '2026-10-04T10:00:00Z', logRoot, toolchain, treeHash }
}

async function checkouts(): Promise<{ first: string; second: string; shared: string }> {
  const parent = await mkTestDir('tao-green-shared-')
  return {
    first: FS.resolvePath('first', parent),
    second: FS.resolvePath('second', parent),
    shared: FS.resolvePath('shared', parent),
  }
}

Describe('shared green-tree store', () => {
  Test('a gate one checkout proved is proved for another checkout at the same tree and toolchain', async () => {
    const { first, second, shared } = await checkouts()
    await GreenTree.record(first, 'verify', entryFor('abc', '/first/logs'), ['_typecheck', 'parser'], {
      sharedRoot: shared,
    })

    const gates = await GreenTree.findGates(second, keyFor('abc'), ['_typecheck', 'parser', 'dead-exports'], {
      sharedRoot: shared,
    })

    Expect([...gates.proved.keys()].sort()).toEqual(['_typecheck', 'parser'])
    Expect(gates.proved.get('parser')?.logRoot).toBe('/first/logs')
  })

  Test('nothing crosses checkouts unless the caller names the shared store on both sides', async () => {
    const { first, second, shared } = await checkouts()
    await GreenTree.record(first, 'verify', entryFor('abc', '/first/logs'), ['_typecheck'])
    Expect((await GreenTree.findGates(second, keyFor('abc'), ['_typecheck'], { sharedRoot: shared })).proved.size)
      .toBe(0)

    await GreenTree.record(first, 'verify', entryFor('abc', '/first/logs'), ['_typecheck'], { sharedRoot: shared })
    Expect((await GreenTree.findGates(second, keyFor('abc'), ['_typecheck'])).proved.size).toBe(0)
  })

  Test('a shared record matches only its own tree and its own toolchain', async () => {
    const { first, second, shared } = await checkouts()
    await GreenTree.record(first, 'verify', entryFor('abc', '/first/logs'), ['_typecheck'], { sharedRoot: shared })
    const otherToolchain = '/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-devenv-profile'

    Expect((await GreenTree.findGates(second, keyFor('abd'), ['_typecheck'], { sharedRoot: shared })).proved.size)
      .toBe(0)
    Expect(
      (await GreenTree.findGates(second, keyFor('abc', otherToolchain), ['_typecheck'], { sharedRoot: shared }))
        .proved.size,
    ).toBe(0)
  })

  Test('an excluded gate is sent back to the machine however it was proved', async () => {
    const { first, second, shared } = await checkouts()
    await GreenTree.record(first, 'verify', entryFor('abc', '/first/logs'), ['parser'], { sharedRoot: shared })

    const gates = await GreenTree.findGates(second, keyFor('abc'), ['parser'], {
      excluded: new Set(['parser']),
      sharedRoot: shared,
    })

    Expect(gates.proved.size).toBe(0)
    Expect(gates.excluded).toEqual(['parser'])
  })

  Test('a whole-lane record stays in the checkout that earned it', async () => {
    const { first, second, shared } = await checkouts()
    await GreenTree.record(first, 'verify', entryFor('abc', '/first/logs'), ['_typecheck'], { sharedRoot: shared })

    Expect(await GreenTree.find(second, keyFor('abc'), ['verify'])).toBeUndefined()
    Expect(await GreenTree.find(first, keyFor('abc'), ['verify'])).toBeDefined()
  })

  Test('an unwritable shared store loses sharing and never the local record', async () => {
    const { first, shared } = await checkouts()
    // A file where the store's directory should be makes every shared write fail.
    await FS.writeText(shared, 'not a directory')

    await GreenTree.record(first, 'verify', entryFor('abc', '/first/logs'), ['_typecheck'], { sharedRoot: shared })

    Expect((await GreenTree.findGates(first, keyFor('abc'), ['_typecheck'])).proved.size).toBe(1)
  })

  Test('the shared root honours an explicit store before the user cache', () => {
    const env = Platform.runtimeProcess.env
    const before = { named: env[GreenTree.SHARED_STORE_ENV_KEY], xdg: env['XDG_CACHE_HOME'] }
    try {
      env[GreenTree.SHARED_STORE_ENV_KEY] = '/ci/green'
      env['XDG_CACHE_HOME'] = '/cache'
      Expect(GreenTree.sharedRoot()).toBe('/ci/green')
      delete env[GreenTree.SHARED_STORE_ENV_KEY]
      Expect(GreenTree.sharedRoot()).toBe('/cache/tao/green')
    } finally {
      for (const [name, value] of [[GreenTree.SHARED_STORE_ENV_KEY, before.named], ['XDG_CACHE_HOME', before.xdg]]) {
        if (value === undefined) {
          delete env[name!]
        } else {
          env[name!] = value
        }
      }
    }
  })
})
