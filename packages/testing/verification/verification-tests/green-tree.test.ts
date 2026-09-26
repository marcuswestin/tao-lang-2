import { CLI, FS } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, mkTestDir, Test } from '@shared/test'
import { GeneratedEvidence } from '../verification-src/GeneratedEvidence'
import { GreenTree, type GreenTreeKey, type GreenTreeRecord } from '../verification-src/GreenTree'

/** The toolchain every store test shares; the toolchain tests below read real symlinks instead. */
const TOOLCHAIN = '/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-devenv-profile'

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await CLI.run('git', { args, cwd, stdio: 'pipe' })
  Expect(result.exitCode).toBe(0)
  return result.stdout
}

async function repository(): Promise<string> {
  const root = await mkGitTestDir('tao-green-tree-')
  await initGitTestRepository(root)
  await git(root, 'config', 'user.email', 'tests@example.invalid')
  await git(root, 'config', 'user.name', 'Tests')
  await FS.writeText(FS.resolvePath('tracked.txt', root), 'one\n')
  await FS.writeText(FS.resolvePath('script.sh', root), '#!/bin/sh\necho tao\n')
  await FS.chmod(FS.resolvePath('script.sh', root), 0o755)
  await FS.writeText(FS.resolvePath('target-one.txt', root), 'same target bytes\n')
  await FS.writeText(FS.resolvePath('target-two.txt', root), 'same target bytes\n')
  await FS.symlink('target-one.txt', FS.resolvePath('current-target', root))
  await FS.writeText(FS.resolvePath('.gitignore', root), 'ignored/\n')
  await git(root, 'add', '.')
  await git(root, 'commit', '--quiet', '--message', 'initial')
  return root
}

function keyFor(treeHash: string, toolchain = TOOLCHAIN): GreenTreeKey {
  return { toolchain, treeHash }
}

function entryFor(treeHash: string, logRoot: string, at = '2026-09-05T10:00:00Z'): GreenTreeRecord {
  return { at, logRoot, toolchain: TOOLCHAIN, treeHash }
}

function profileLink(root: string): string {
  return FS.resolvePath('.devenv/profile', root)
}

function recordFile(root: string, name: string): string {
  return FS.resolvePath(name, FS.resolvePath(GreenTree.STORE_DIR, root))
}

Describe('green tree records', () => {
  Test('compiled-app evidence closes over the ignored parser tree it consumes', () => {
    Expect(GeneratedEvidence.outputsForGates(['_compile-word-flower-app'])).toEqual(['compiled-app', 'parser'])
  })

  Test('IDE evidence closes over the ignored parser tree it consumes', () => {
    Expect(GeneratedEvidence.outputsForGates(['_ide-extension-build'])).toEqual(['ide-extension', 'parser'])
  })

  Test('IDE evidence invalidates on installed input or either generated output tree changing', async () => {
    const root = await mkTestDir('tao-green-tree-ide-generated-')
    const wasm = FS.resolvePath('packages/language/formatter/node_modules/@dprint/typescript/plugin.wasm', root)
    const bundleRoot = FS.resolvePath('packages/ides/ide-extension/_gen_ide-extension', root)
    const syntaxRoot = FS.resolvePath('packages/ides/ide-extension/ide-extension-syntaxes/_gen_syntaxes', root)
    const bundle = FS.resolvePath('extension/main.cjs', bundleRoot)
    const added = FS.resolvePath('language/added.cjs', bundleRoot)
    const syntax = FS.resolvePath('tao.tmLanguage.json', syntaxRoot)
    try {
      await FS.writeText(wasm, 'wasm-one')
      await FS.writeText(bundle, 'bundle-one\n')
      await FS.writeText(syntax, '{"name":"Tao"}\n')
      const generated = await GeneratedEvidence.capture(root, ['ide-extension'])
      Expect(generated).toBeDefined()
      await GreenTree.record(root, 'verify', entryFor('tree-1', '/logs/verify'), [], {
        laneGenerated: generated,
      })
      const find = async () =>
        await GreenTree.find(root, keyFor('tree-1'), ['verify'], {
          generatedOutputs: ['ide-extension'],
        })
      Expect(await find()).toBeDefined()

      const cases = [
        {
          mutate: async () => await FS.writeText(wasm, 'wasm-two'),
          restore: async () => await FS.writeText(wasm, 'wasm-one'),
        },
        {
          mutate: async () => await FS.writeText(bundle, 'bundle-two\n'),
          restore: async () => await FS.writeText(bundle, 'bundle-one\n'),
        },
        {
          mutate: async () => await FS.writeText(added, 'added\n'),
          restore: async () => await FS.remove(added),
        },
        {
          mutate: async () => await FS.remove(syntax),
          restore: async () => await FS.writeText(syntax, '{"name":"Tao"}\n'),
        },
        {
          mutate: async () => await FS.remove(bundleRoot),
          restore: async () => await FS.writeText(bundle, 'bundle-one\n'),
        },
        {
          mutate: async () => await FS.remove(syntaxRoot),
          restore: async () => await FS.writeText(syntax, '{"name":"Tao"}\n'),
        },
      ]
      for (const scenario of cases) {
        await scenario.mutate()
        Expect(await find()).toBeUndefined()
        await scenario.restore()
        Expect(await find()).toBeDefined()
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('generated output evidence invalidates a lane on edit, addition, deletion, or absence', async () => {
    const root = await mkTestDir('tao-green-tree-generated-')
    const outputRoot = FS.resolvePath('packages/apps/expo-host/_gen_tao-app', root)
    const app = FS.resolvePath('App.tsx', outputRoot)
    const added = FS.resolvePath('Added.tsx', outputRoot)
    try {
      await FS.writeText(app, 'export default 1\n')
      const generated = await GeneratedEvidence.capture(root, ['compiled-app'])
      Expect(generated).toBeDefined()
      await GreenTree.record(root, 'verify', entryFor('tree-1', '/logs/verify'), [], {
        laneGenerated: generated,
      })
      const find = async () =>
        await GreenTree.find(root, keyFor('tree-1'), ['verify'], {
          generatedOutputs: ['compiled-app'],
        })
      Expect(await find()).toBeDefined()

      const cases = [
        {
          mutate: async () => await FS.writeText(app, 'export default 2\n'),
          restore: async () => await FS.writeText(app, 'export default 1\n'),
        },
        {
          mutate: async () => await FS.writeText(added, 'export const added = true\n'),
          restore: async () => await FS.remove(added),
        },
        {
          mutate: async () => await FS.remove(app),
          restore: async () => await FS.writeText(app, 'export default 1\n'),
        },
        {
          mutate: async () => await FS.remove(outputRoot),
          restore: async () => await FS.writeText(app, 'export default 1\n'),
        },
      ]
      for (const scenario of cases) {
        await scenario.mutate()
        Expect(await find()).toBeUndefined()
        await scenario.restore()
        Expect(await find()).toBeDefined()
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('generated evidence fails closed on missing, changed-input, or unknown evidence', async () => {
    const root = await mkTestDir('tao-green-tree-generated-invalid-')
    try {
      const entry = entryFor('tree-1', '/logs/verify')
      await GreenTree.record(root, 'verify', entry)
      Expect(
        await GreenTree.find(root, keyFor('tree-1'), ['verify'], {
          captureGenerated: async () => ({
            outputs: { parser: { inputs: 'inputs-1', outputs: 'outputs-1' } },
            version: 1,
          }),
          generatedOutputs: ['parser'],
        }),
      ).toBeUndefined()

      await GreenTree.record(root, 'verify', entry, [], {
        laneGenerated: {
          outputs: { parser: { inputs: 'inputs-1', outputs: 'outputs-1' } },
          version: 1,
        },
      })
      Expect(
        await GreenTree.find(root, keyFor('tree-1'), ['verify'], {
          captureGenerated: async () => ({
            outputs: { parser: { inputs: 'inputs-2', outputs: 'outputs-1' } },
            version: 1,
          }),
          generatedOutputs: ['parser'],
        }),
      ).toBeUndefined()

      await FS.writeJson(recordFile(root, 'lane-verify.json'), {
        ...entry,
        generated: {
          outputs: { unknown: { inputs: 'inputs', outputs: 'outputs' } },
          version: 1,
        },
        kind: 'lane',
        name: 'verify',
      })
      Expect((await GreenTree.load(root)).lanes['verify']).toBeUndefined()

      await FS.writeJson(recordFile(root, 'lane-verify.json'), {
        ...entry,
        generated: {
          outputs: { parser: { inputs: 'inputs', outputs: 'outputs' } },
          unexpected: true,
          version: 1,
        },
        kind: 'lane',
        name: 'verify',
      })
      Expect((await GreenTree.load(root)).lanes['verify']).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })

  Test('the tree hash follows the working tree, staged or not, and the untracked files in it', async () => {
    const root = await repository()
    const clean = await GreenTree.hashTree(root)
    Expect(await GreenTree.hashTree(root)).toBe(clean)

    await FS.writeText(FS.resolvePath('tracked.txt', root), 'two\n')
    const edited = await GreenTree.hashTree(root)
    Expect(edited).not.toBe(clean)
    await git(root, 'add', 'tracked.txt')
    // Staging the same content is the same tree.
    Expect(await GreenTree.hashTree(root)).toBe(edited)

    await FS.writeText(FS.resolvePath('new.txt', root), 'new\n')
    const withUntracked = await GreenTree.hashTree(root)
    Expect(withUntracked).not.toBe(edited)
    await FS.writeText(FS.resolvePath('new.txt', root), 'changed\n')
    Expect(await GreenTree.hashTree(root)).not.toBe(withUntracked)

    // Moving the exact same bytes from the diff into HEAD does not change the visible tree.
    const beforeCommit = await GreenTree.hashTree(root)
    await git(root, 'add', '.')
    await git(root, 'commit', '--quiet', '--message', 'same visible tree')
    Expect(await GreenTree.hashTree(root)).toBe(beforeCommit)

    // An ignored file is derived state and never part of the identity.
    await FS.mkdir(FS.resolvePath('ignored', root))
    const before = await GreenTree.hashTree(root)
    await FS.writeText(FS.resolvePath('ignored/output.txt', root), 'anything\n')
    Expect(await GreenTree.hashTree(root)).toBe(before)
  })

  Test('the tree hash includes Git-visible executable and symlink modes', async () => {
    const root = await repository()
    const clean = await GreenTree.hashTree(root)

    await FS.chmod(FS.resolvePath('script.sh', root), 0o644)
    Expect(await git(root, 'status', '--short')).toContain('script.sh')
    Expect(await GreenTree.hashTree(root)).not.toBe(clean)
    await FS.chmod(FS.resolvePath('script.sh', root), 0o755)
    Expect(await GreenTree.hashTree(root)).toBe(clean)

    const untracked = FS.resolvePath('untracked-script.sh', root)
    await FS.writeText(untracked, '#!/bin/sh\necho untracked\n')
    await FS.chmod(untracked, 0o644)
    const untrackedNonExecutable = await GreenTree.hashTree(root)
    await FS.chmod(untracked, 0o645)
    Expect(await GreenTree.hashTree(root)).not.toBe(untrackedNonExecutable)

    await FS.remove(FS.resolvePath('current-target', root))
    await FS.symlink('target-two.txt', FS.resolvePath('current-target', root))
    Expect(await git(root, 'status', '--short')).toContain('current-target')
    Expect(await GreenTree.hashTree(root)).not.toBe(clean)
  })

  Test('the fingerprint hash is the tree hash, and its paths name what moved', async () => {
    const root = await repository()
    const before = await GreenTree.fingerprint(root)
    // The two entry points must never be able to disagree about what the tree is.
    Expect(before.hash).toBe(await GreenTree.hashTree(root))
    Expect(GreenTree.changedPaths(before, before)).toEqual([])
    Expect([...before.paths.keys()]).toContain('tracked.txt')

    await FS.writeText(FS.resolvePath('tracked.txt', root), 'rewritten\n')
    await FS.writeText(FS.resolvePath('added.txt', root), 'added\n')
    await FS.remove(FS.resolvePath('script.sh', root))

    const after = await GreenTree.fingerprint(root)
    Expect(after.hash).toBe(await GreenTree.hashTree(root))
    Expect(after.hash).not.toBe(before.hash)
    Expect(GreenTree.changedPaths(before, after)).toEqual(['added.txt', 'script.sh', 'tracked.txt'])
    // Direction does not change which paths disagree.
    Expect(GreenTree.changedPaths(after, before)).toEqual(['added.txt', 'script.sh', 'tracked.txt'])
    Expect(after.paths.has('script.sh')).toBe(false)
    Expect(GreenTree.changedPaths(after, after)).toEqual([])
  })

  Test('a lane finds its own record and a superset lane record, never a stranger', async () => {
    const root = await mkTestDir('tao-green-tree-store-')
    try {
      Expect(await GreenTree.find(root, keyFor('abc'), ['verify'])).toBeUndefined()

      await GreenTree.record(root, 'verify-full', entryFor('abc', '/logs/full'))
      await GreenTree.record(root, 'verify', entryFor('def', '/logs/verify', '2026-09-05T11:00:00Z'))

      Expect(await GreenTree.find(root, keyFor('abc'), ['verify', 'verify-full'])).toEqual({
        at: '2026-09-05T10:00:00Z',
        lane: 'verify-full',
        logRoot: '/logs/full',
        toolchain: TOOLCHAIN,
        treeHash: 'abc',
      })
      Expect((await GreenTree.find(root, keyFor('def'), ['verify', 'verify-full']))?.lane).toBe('verify')
      Expect(await GreenTree.find(root, keyFor('def'), ['verify-full'])).toBeUndefined()
      Expect(await GreenTree.find(root, keyFor('zzz'), ['verify', 'verify-full'])).toBeUndefined()

      // A new record for a lane replaces the old one; a lane proves one tree at a time.
      await GreenTree.record(root, 'verify', entryFor('ghi', '/logs/verify-2', '2026-09-05T12:00:00Z'))
      Expect(await GreenTree.find(root, keyFor('def'), ['verify'])).toBeUndefined()
      Expect((await GreenTree.load(root)).lanes['verify']?.treeHash).toBe('ghi')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a gate record is found at its own tree, whatever lane proved it', async () => {
    const root = await mkTestDir('tao-green-tree-gates-')
    try {
      await GreenTree.record(root, 'verify', entryFor('abc', '/logs/verify'), ['_typecheck', '_test'])

      const proved = await GreenTree.findGates(root, keyFor('abc'), ['_typecheck', '_test', 'dead-exports'])
      Expect([...proved.proved.keys()].sort()).toEqual(['_test', '_typecheck'])
      Expect(proved.excluded).toEqual([])
      // A gate proves the tree it ran against and no other.
      Expect((await GreenTree.findGates(root, keyFor('def'), ['_typecheck'])).proved).toEqual(new Map())

      // A later run at another tree replaces the gate's record, exactly as it replaces a lane's.
      await GreenTree.record(root, 'verify', entryFor('def', '/logs/verify-2', '2026-09-05T11:00:00Z'), ['_typecheck'])
      Expect([...(await GreenTree.findGates(root, keyFor('abc'), ['_typecheck', '_test'])).proved.keys()])
        .toEqual(['_test'])
      Expect((await GreenTree.findGates(root, keyFor('def'), ['_typecheck'])).proved.get('_typecheck')?.logRoot)
        .toBe('/logs/verify-2')
    } finally {
      await FS.remove(root)
    }
  })

  Test('the same tree read by another toolchain is not the same proof', async () => {
    const root = await mkTestDir('tao-green-tree-toolchain-')
    const sameTree = { hashTree: async () => 'one-unchanging-tree' }
    try {
      await FS.symlink('/nix/store/first-profile', profileLink(root))
      const first = await GreenTree.key(root, sameTree)
      Expect(first.toolchain).toBe('/nix/store/first-profile')
      await GreenTree.record(root, 'verify', { ...first, at: '2026-09-05T10:00:00Z', logRoot: '/logs/verify' }, [
        '_typecheck',
      ])
      Expect((await GreenTree.find(root, first, ['verify']))?.logRoot).toBe('/logs/verify')

      // The same bytes, a different pinned profile: bun, node, just and dprint all moved.
      await FS.replaceSymlink('/nix/store/second-profile', profileLink(root))
      const second = await GreenTree.key(root, sameTree)
      Expect(second.treeHash).toBe(first.treeHash)
      Expect(second.toolchain).toBe('/nix/store/second-profile')
      Expect(await GreenTree.find(root, second, ['verify'])).toBeUndefined()
      Expect((await GreenTree.findGates(root, second, ['_typecheck'])).proved).toEqual(new Map())

      // A checkout with no pinned profile still runs; it just never matches a profiled record.
      await FS.remove(profileLink(root))
      const none = await GreenTree.key(root, sameTree)
      Expect(none.toolchain).toBe(GreenTree.NO_TOOLCHAIN)
      Expect(await GreenTree.find(root, none, ['verify'])).toBeUndefined()

      // Pointing it back is the original proof again, because the key is the profile, not the clock.
      await FS.symlink('/nix/store/first-profile', profileLink(root))
      Expect((await GreenTree.find(root, await GreenTree.key(root, sameTree), ['verify']))?.logRoot)
        .toBe('/logs/verify')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a record written before the toolchain field existed never matches', async () => {
    const root = await mkTestDir('tao-green-tree-legacy-')
    try {
      // The single-file store this directory replaced, exactly as an older checkout left it.
      await FS.writeJson(FS.resolvePath('.artifacts/verify/green-trees.json', root), {
        gates: { _typecheck: { at: '2026-09-04T10:00:00Z', logRoot: '/logs/old', treeHash: 'abc' } },
        lanes: { verify: { at: '2026-09-04T10:00:00Z', logRoot: '/logs/old', treeHash: 'abc' } },
        version: 1,
      })
      Expect(await GreenTree.find(root, keyFor('abc'), ['verify'])).toBeUndefined()
      Expect(await GreenTree.load(root)).toEqual({ gates: {}, lanes: {} })

      // A per-record file from before the field is equally untrusted, whatever its tree says.
      await FS.writeJson(recordFile(root, 'lane-verify.json'), {
        at: '2026-09-04T11:00:00Z',
        kind: 'lane',
        logRoot: '/logs/older',
        name: 'verify',
        treeHash: 'abc',
      })
      Expect(await GreenTree.find(root, keyFor('abc'), ['verify'])).toBeUndefined()
      Expect(await GreenTree.load(root)).toEqual({ gates: {}, lanes: {} })

      // Writing a record removes the store it replaced rather than leaving it to be read again.
      await GreenTree.record(root, 'verify', entryFor('abc', '/logs/verify'))
      Expect(await FS.exists(FS.resolvePath('.artifacts/verify/green-trees.json', root))).toBe(false)
      Expect((await GreenTree.find(root, keyFor('abc'), ['verify']))?.logRoot).toBe('/logs/verify')
    } finally {
      await FS.remove(root)
    }
  })

  Test('concurrent writers each publish a whole record, and a reader never sees a torn one', async () => {
    const root = await mkTestDir('tao-green-tree-concurrent-')
    try {
      // Payloads large enough, and different enough from each other, that a write straight to the
      // record path would leave one writer's bytes inside another's file.
      const writers = Array.from({ length: 24 }, (_, index) => ({
        at: `2026-09-05T${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${
          String(index % 60).padStart(2, '0')
        }:00Z`,
        logRoot: `/logs/writer-${index}/${String(index).repeat(90_000 + index * 8_000)}`,
        toolchain: TOOLCHAIN,
        treeHash: 'abc',
      }))
      const whole = new Set(writers.map(writer => `${writer.at}\0${writer.logRoot}`))
      const identity = (record: GreenTreeRecord | undefined) => `${record?.at}\0${record?.logRoot}`

      // A record is on disk before the contention starts, so from here on every read of the lane
      // must answer with some writer's whole record: an atomic publish is never observably absent.
      await GreenTree.record(root, 'verify', writers[0]!, ['gate-0'])
      let writing = true
      let reads = 0
      let torn = 0
      const readUntilWritten = async () => {
        while (writing) {
          const found = await GreenTree.find(root, keyFor('abc'), ['verify'])
          reads += 1
          if (!whole.has(identity(found))) {
            torn += 1
          }
        }
      }
      const readers = [readUntilWritten(), readUntilWritten(), readUntilWritten()]
      const writes = Promise.all(
        writers.map(async (writer, index) => GreenTree.record(root, 'verify', writer, [`gate-${index}`])),
      ).finally(() => {
        writing = false
      })
      await Promise.all([...readers, writes])

      // The readers really did sample the directory while it was being written, not just after.
      Expect(reads).toBeGreaterThan(3)
      Expect(torn).toBe(0)
      // The survivor of the contended lane file is one writer's record entire, not a mixture.
      Expect(whole.has(identity(await GreenTree.find(root, keyFor('abc'), ['verify'])))).toBe(true)

      const gates = await GreenTree.findGates(root, keyFor('abc'), writers.map((_, index) => `gate-${index}`))
      Expect(gates.proved.size).toBe(writers.length)
      for (const record of gates.proved.values()) {
        Expect(whole.has(identity(record))).toBe(true)
      }
      // Nothing is left behind for the next reader to trip over.
      Expect((await FS.listDir(FS.resolvePath(GreenTree.STORE_DIR, root))).filter(name => name.endsWith('.tmp')))
        .toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('a damaged record file loses its own skip and nothing else', async () => {
    const root = await mkTestDir('tao-green-tree-damaged-')
    try {
      await GreenTree.record(root, 'verify', entryFor('abc', '/logs/verify'), ['_typecheck', '_test'])
      const truncated = await FS.readText(recordFile(root, 'gate-_typecheck.json'))
      await FS.writeText(recordFile(root, 'gate-_typecheck.json'), truncated.slice(0, 24))

      const gates = await GreenTree.findGates(root, keyFor('abc'), ['_typecheck', '_test'])
      Expect([...gates.proved.keys()]).toEqual(['_test'])
      Expect(Object.keys((await GreenTree.load(root)).gates)).toEqual(['_test'])
      // The lane record beside it is untouched, so the whole lane still stands on its own proof.
      Expect((await GreenTree.find(root, keyFor('abc'), ['verify']))?.logRoot).toBe('/logs/verify')

      // Garbage that is not JSON at all, and a record whose file was renamed under it, read the same.
      await FS.writeText(recordFile(root, 'lane-verify.json'), 'not json at all')
      Expect(await GreenTree.find(root, keyFor('abc'), ['verify'])).toBeUndefined()
      await FS.writeJson(recordFile(root, 'gate-_test.json'), {
        ...entryFor('abc', '/logs/verify'),
        kind: 'gate',
        name: 'some-other-gate',
      })
      Expect((await GreenTree.findGates(root, keyFor('abc'), ['_test'])).proved).toEqual(new Map())
      Expect(await GreenTree.load(root)).toEqual({ gates: {}, lanes: {} })
    } finally {
      await FS.remove(root)
    }
  })

  Test('recording a gate the caller never records fails instead of writing a false green', async () => {
    const root = await mkTestDir('tao-green-tree-never-')
    try {
      await Expect(GreenTree.record(
        root,
        'verify-full',
        entryFor('abc', '/logs/full'),
        ['_typecheck', 'studio-smoke'],
        { neverRecord: new Set(['studio-smoke']) },
      )).rejects.toThrow('host-dependent gate is never recorded')
      // The refused call wrote nothing at all, not even the gates it was allowed to record.
      Expect(await GreenTree.load(root)).toEqual({ gates: {}, lanes: {} })

      // The same call without that gate is ordinary.
      await GreenTree.record(root, 'verify-full', entryFor('abc', '/logs/full'), ['_typecheck'], {
        neverRecord: new Set(['studio-smoke']),
      })
      Expect([...(await GreenTree.findGates(root, keyFor('abc'), ['_typecheck'])).proved.keys()])
        .toEqual(['_typecheck'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('an excluded gate runs again at the identical tree, and says it was excluded', async () => {
    const root = await mkTestDir('tao-green-tree-excluded-')
    try {
      await GreenTree.record(root, 'verify', entryFor('abc', '/logs/verify'), ['_typecheck', '_test'])

      const gates = await GreenTree.findGates(root, keyFor('abc'), ['_typecheck', '_test', 'dead-exports'], {
        excluded: new Set(['_test', 'dead-exports']),
      })
      Expect([...gates.proved.keys()]).toEqual(['_typecheck'])
      // Only a gate whose record would have been reused is reported; the unrecorded one is not news.
      Expect(gates.excluded).toEqual(['_test'])
      Expect(GreenTree.describeExclusion('_test')).toContain('_test')
      Expect(GreenTree.describeExclusion('_test')).toContain('excluded')
    } finally {
      await FS.remove(root)
    }
  })

  Test('the skip line names the run it stands on and says when it was a superset lane', () => {
    const match = {
      at: '2026-09-05T10:00:00Z',
      lane: 'verify-full',
      logRoot: '/repo/.artifacts/logs/verify-full/run',
      toolchain: TOOLCHAIN,
      treeHash: 'abc',
    }

    Expect(GreenTree.describe('verify', match)).toContain('tree unchanged since the green run at 2026-09-05T10:00:00Z')
    Expect(GreenTree.describe('verify', match)).toContain('verify-full, a superset of verify')
    Expect(GreenTree.describe('verify-full', match)).not.toContain('superset')
    Expect(GreenTree.describeGate(match)).toContain('/repo/.artifacts/logs/verify-full/run')
  })
})
