import { CLI, FS } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'
import { readMyStatus } from '../dev-cli-src/doctor/MyStatusCommand'

Describe('personal checkout status', () => {
  Test('reports this checkout’s staged, unstaged, and untracked work without changing it', async () => {
    const root = await mkGitTestDir('tao-my-status-')
    await initGitTestRepository(root, { commit: { files: { 'base.txt': 'base\n' } } })
    const git = async (...args: string[]) => await CLI.mustRun('git', { args, cwd: root, stdio: 'pipe' })
    await git('switch', '--create', 'dev/mira')
    await FS.writeText(FS.resolvePath('base.txt', root), 'edited\n')
    await FS.writeText(FS.resolvePath('staged.txt', root), 'staged\n')
    await git('add', 'staged.txt')
    await FS.writeText(FS.resolvePath('scratch.txt', root), 'untracked\n')
    const before = (await git('status', '--porcelain=v1', '--untracked-files=all')).stdout

    const output = await readMyStatus(root)

    Expect(output).toContain('Branch: dev/mira')
    Expect(output).toContain('Local main: ahead 0, behind 0')
    Expect(output).toContain('Verification: none recorded')
    Expect(output).toContain('Staged (1):\n  staged.txt')
    Expect(output).toContain('Unstaged (1):\n  base.txt')
    Expect(output).toContain('Untracked (1):\n  scratch.txt')
    Expect(output).toContain('Next: Coordinate ownership, then stage and commit only your intended paths.')
    Expect((await git('status', '--porcelain=v1', '--untracked-files=all')).stdout).toBe(before)
  })
})
