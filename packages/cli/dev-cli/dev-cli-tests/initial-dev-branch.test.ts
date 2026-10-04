import { CLI, FS, Repo } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'

const SCRIPT = Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/initial-dev-branch.zsh')

Describe('initial developer branch setup', () => {
  Test('branches only the primary checkout on main and leaves subsequent setup alone', async () => {
    const root = await mkGitTestDir('tao-initial-branch-')
    try {
      const primary = FS.resolvePath('primary', root)
      const linked = FS.resolvePath('linked', root)
      await initGitTestRepository(primary, { commit: { files: { 'base.txt': 'base' }, message: 'base' } })
      await git(primary, ['branch', '-M', 'main'])
      // A tiny real Justfile observes the literal command and changes HEAD as the public recipe does.
      await FS.writeText(
        FS.resolvePath('Justfile', primary),
        [
          'my-branch:',
          '    @echo invoked >> calls.txt',
          '    @git switch -c dev/person',
          '',
        ].join('\n'),
      )
      await git(primary, ['worktree', 'add', '--detach', linked, 'main'])
      Expect((await setup(linked)).exitCode).toBe(0)
      await git(primary, ['switch', '--detach'])
      await git(linked, ['switch', 'main'])
      Expect((await setup(linked)).exitCode).toBe(0)
      Expect(await branch(linked)).toBe('main')
      Expect((await setup(primary)).exitCode).toBe(0)
      Expect(await branch(primary)).toBe('')
      await git(linked, ['switch', '--detach'])
      await git(primary, ['switch', '-c', 'feat/existing'])
      Expect((await setup(primary)).exitCode).toBe(0)
      Expect(await branch(primary)).toBe('feat/existing')
      Expect(await FS.exists(FS.resolvePath('calls.txt', primary))).toBe(false)
      await git(primary, ['switch', 'main'])
      Expect((await setup(primary)).exitCode).toBe(0)
      Expect(await branch(primary)).toBe('dev/person')
      Expect((await setup(primary)).exitCode).toBe(0)
      Expect(await branch(primary)).toBe('dev/person')
      Expect(await FS.readText(FS.resolvePath('calls.txt', primary))).toBe('invoked\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('propagates a refused personal branch switch', async () => {
    const root = await mkGitTestDir('tao-initial-branch-failure-')
    try {
      await initGitTestRepository(root, { commit: { files: { 'base.txt': 'base' }, message: 'base' } })
      await git(root, ['branch', '-M', 'main'])
      await FS.writeText(FS.resolvePath('Justfile', root), 'my-branch:\n    @exit 7\n')
      const result = await setup(root)
      Expect(result.exitCode).not.toBe(0)
      Expect(await branch(root)).toBe('main')
    } finally {
      await FS.remove(root)
    }
  })
})

async function setup(cwd: string): Promise<CLI.CommandResult> {
  return CLI.run('zsh', { args: [SCRIPT], cwd })
}

async function branch(cwd: string): Promise<string> {
  return (await CLI.run('git', { args: ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd })).stdout.trim()
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const result = await CLI.run('git', { args, cwd })
  Expect(result.exitCode).toBe(0)
}
