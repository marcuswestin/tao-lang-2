import { CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { MergeRecovery } from '../dev-cli-src/git/MergeRecovery'

Describe('merge recovery', () => {
  Test('aborts an active merge and restores the feature branch files', async () => {
    const root = await repository()
    try {
      await FS.writeText(FS.resolvePath('protected.txt', root), 'main\n')
      await commit(root, 'main edit')
      const main = await git(root, ['rev-parse', 'HEAD'])
      const base = await git(root, ['rev-parse', 'HEAD^'])
      await git(root, ['switch', '-c', 'feat/recover', base])
      await FS.writeText(FS.resolvePath('protected.txt', root), 'feature\n')
      await commit(root, 'feature edit')

      const merge = await CLI.run('git', { args: ['merge', main], cwd: root })
      Expect(merge.exitCode).not.toBe(0)
      await MergeRecovery.run({ root })

      Expect(await git(root, ['status', '--porcelain'])).toBe('')
      Expect(await FS.readText(FS.resolvePath('protected.txt', root))).toBe('feature\n')
      Expect((await CLI.run('git', { args: ['rev-parse', '--verify', '-q', 'MERGE_HEAD'], cwd: root })).exitCode)
        .not.toBe(0)
    } finally {
      await FS.remove(root)
    }
  })

  Test('requires an explicit ORIG_HEAD SHA before resetting a partial fast-forward', async () => {
    const root = await repository()
    try {
      const base = await git(root, ['rev-parse', 'HEAD'])
      await FS.writeText(FS.resolvePath('protected.txt', root), 'main\n')
      await commit(root, 'main edit')
      const main = await git(root, ['rev-parse', 'HEAD'])
      await git(root, ['switch', '-c', 'feat/recover', base])
      await git(root, ['merge', main])
      await FS.writeText(FS.resolvePath('protected.txt', root), 'base\n')

      await Expect(MergeRecovery.run({ root })).rejects.toThrow('No merge is in progress')
      await Expect(MergeRecovery.run({ resetTo: main, root })).rejects.toThrow('must equal')
      await Expect(MergeRecovery.run({ resetTo: base, root })).rejects.toThrow()
      Expect(await git(root, ['rev-parse', 'HEAD'])).toBe(main)

      await MergeRecovery.run({ hard: true, resetTo: base, root })
      Expect(await git(root, ['rev-parse', 'HEAD'])).toBe(base)
      Expect(await git(root, ['status', '--porcelain'])).toBe('')
      Expect(await FS.readText(FS.resolvePath('protected.txt', root))).toBe('base\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses recovery on main', async () => {
    const root = await repository()
    try {
      await Expect(MergeRecovery.run({ root })).rejects.toThrow('other than main')
    } finally {
      await FS.remove(root)
    }
  })
})

async function repository(): Promise<string> {
  const root = await mkTestDir('tao-merge-recover-')
  await git(root, ['init', '-b', 'main'])
  await FS.writeText(FS.resolvePath('protected.txt', root), 'base\n')
  await commit(root, 'base')
  return root
}

async function commit(root: string, message: string): Promise<void> {
  await git(root, ['add', 'protected.txt'])
  await git(root, ['-c', 'user.name=Tao Test', '-c', 'user.email=tao@example.test', 'commit', '-m', message])
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await CLI.run('git', { args, cwd: root })
  Expect(result.exitCode).toBe(0)
  return result.stdout.trim()
}
