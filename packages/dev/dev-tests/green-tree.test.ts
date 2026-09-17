import { CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { GreenTree } from '../dev-src/repository-tests/GreenTree'

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await CLI.run('git', { args, cwd, stdio: 'pipe' })
  Expect(result.exitCode).toBe(0)
  return result.stdout
}

async function repository(): Promise<string> {
  const root = await mkTestDir('tao-green-tree-')
  await git(root, 'init', '--quiet', '--initial-branch=main')
  await git(root, 'config', 'user.email', 'tests@example.invalid')
  await git(root, 'config', 'user.name', 'Tests')
  await FS.writeText(FS.resolvePath('tracked.txt', root), 'one\n')
  await FS.writeText(FS.resolvePath('.gitignore', root), 'ignored/\n')
  await git(root, 'add', '.')
  await git(root, 'commit', '--quiet', '--message', 'initial')
  return root
}

Describe('green tree records', () => {
  Test('the tree hash follows the working tree, staged or not, and the untracked files in it', async () => {
    const root = await repository()
    try {
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

      // An ignored file is derived state and never part of the identity.
      await FS.mkdir(FS.resolvePath('ignored', root))
      const before = await GreenTree.hashTree(root)
      await FS.writeText(FS.resolvePath('ignored/output.txt', root), 'anything\n')
      Expect(await GreenTree.hashTree(root)).toBe(before)
    } finally {
      await FS.remove(root)
    }
  })

  Test('a lane finds its own record and a superset lane record, never a stranger', async () => {
    const root = await mkTestDir('tao-green-tree-store-')
    try {
      Expect(await GreenTree.find(root, 'abc', ['verify'])).toBeUndefined()

      await GreenTree.record(root, 'full-verify', {
        at: '2026-09-05T10:00:00Z',
        logRoot: '/logs/full',
        treeHash: 'abc',
      })
      await GreenTree.record(root, 'verify', { at: '2026-09-05T11:00:00Z', logRoot: '/logs/verify', treeHash: 'def' })

      Expect(await GreenTree.find(root, 'abc', ['verify', 'full-verify'])).toEqual({
        at: '2026-09-05T10:00:00Z',
        lane: 'full-verify',
        logRoot: '/logs/full',
        treeHash: 'abc',
      })
      Expect((await GreenTree.find(root, 'def', ['verify', 'full-verify']))?.lane).toBe('verify')
      Expect(await GreenTree.find(root, 'def', ['full-verify'])).toBeUndefined()
      Expect(await GreenTree.find(root, 'zzz', ['verify', 'full-verify'])).toBeUndefined()

      // A new record for a lane replaces the old one; a lane proves one tree at a time.
      await GreenTree.record(root, 'verify', { at: '2026-09-05T12:00:00Z', logRoot: '/logs/verify-2', treeHash: 'ghi' })
      Expect(await GreenTree.find(root, 'def', ['verify'])).toBeUndefined()
      Expect((await GreenTree.load(root)).lanes['verify']?.treeHash).toBe('ghi')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a gate record is found at its own tree, whatever lane proved it', async () => {
    const root = await mkTestDir('tao-green-tree-gates-')
    try {
      await GreenTree.record(
        root,
        'verify',
        { at: '2026-09-05T10:00:00Z', logRoot: '/logs/verify', treeHash: 'abc' },
        ['_typecheck', '_test'],
      )

      Expect([...(await GreenTree.findGates(root, 'abc', ['_typecheck', '_test', 'dead-exports'])).keys()].sort())
        .toEqual(['_test', '_typecheck'])
      // A gate proves the tree it ran against and no other.
      Expect(await GreenTree.findGates(root, 'def', ['_typecheck'])).toEqual(new Map())

      // A later run at another tree replaces the gate's record, exactly as it replaces a lane's.
      await GreenTree.record(
        root,
        'verify',
        { at: '2026-09-05T11:00:00Z', logRoot: '/logs/verify-2', treeHash: 'def' },
        ['_typecheck'],
      )
      Expect([...(await GreenTree.findGates(root, 'abc', ['_typecheck', '_test'])).keys()]).toEqual(['_test'])
      Expect((await GreenTree.findGates(root, 'def', ['_typecheck'])).get('_typecheck')?.logRoot)
        .toBe('/logs/verify-2')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a damaged store reads as empty instead of failing the lane', async () => {
    const root = await mkTestDir('tao-green-tree-damaged-')
    try {
      await FS.writeText(FS.resolvePath(GreenTree.STORE_PATH, root), '{"version": 99, "lanes": "no"}')
      Expect(await GreenTree.load(root)).toEqual({ gates: {}, lanes: {}, version: 1 })
    } finally {
      await FS.remove(root)
    }
  })

  Test('the skip line names the run it stands on and says when it was a superset lane', () => {
    const match = {
      at: '2026-09-05T10:00:00Z',
      lane: 'full-verify',
      logRoot: '/repo/.artifacts/logs/full-verify/run',
      treeHash: 'abc',
    }

    Expect(GreenTree.describe('verify', match)).toContain('tree unchanged since the green run at 2026-09-05T10:00:00Z')
    Expect(GreenTree.describe('verify', match)).toContain('full-verify, a superset of verify')
    Expect(GreenTree.describe('full-verify', match)).not.toContain('superset')
  })
})
