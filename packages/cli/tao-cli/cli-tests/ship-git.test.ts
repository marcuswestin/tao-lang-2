import { CLI, FS } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, mkTestDir, Test } from '@shared/test'
import {
  inspectShipGit,
  shipNotesSince,
  shipSourceMatchesBuild,
} from '../cli-src/ship-git'

async function git(root: string, ...args: string[]): Promise<string> {
  return (await CLI.mustRun('git', { args: ['-C', root, ...args] })).stdout.trim()
}

Describe('tao ship git behavior', () => {
  Test('keeps the index, HEAD, and refs byte-identical while deriving provenance and notes', async () => {
    const root = await mkGitTestDir('tao-ship-git-')
    await initGitTestRepository(root)
    await git(root, 'config', 'user.email', 'test@example.com')
    await git(root, 'config', 'user.name', 'Tao Test')
    const projectPath = FS.resolvePath('App.tao', root)
    const lockPath = FS.resolvePath('.tao-project/lock.jsonc', root)
    await FS.writeText(projectPath, 'project { version "1.0.0" }\n')
    await FS.writeText(lockPath, '{"schemaVersion":1}\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-qm', 'Initial')
    const clean = await inspectShipGit(root)
    Expect(clean.dirty).toBe(false)

    const stagedPath = FS.resolvePath('User.txt', root)
    await FS.writeText(stagedPath, 'already staged by the user\n')
    await git(root, 'add', 'User.txt')
    const indexBefore = await FS.readFile(FS.resolvePath('.git/index', root))
    const headBefore = await git(root, 'rev-parse', 'HEAD')
    const refsBefore = await git(root, 'show-ref')

    await FS.writeText(projectPath, 'project { version "1.0.1" }\n')
    await FS.writeText(lockPath, '{"schemaVersion":1,"ship":{}}\n')
    const dirty = await inspectShipGit(root)
    Expect(dirty.dirty).toBe(true)
    Expect(dirty.dirtyFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    Expect(await git(root, 'rev-parse', 'HEAD')).toBe(headBefore)
    Expect(await git(root, 'show-ref')).toBe(refsBefore)
    Expect(await FS.readFile(FS.resolvePath('.git/index', root))).toEqual(indexBefore)
    Expect(await git(root, 'tag', '--list')).toBe('')
    Expect(await shipNotesSince(clean)).toContain('Initial')
  })

  Test('fingerprints the exact dirty tree and changes when dirty bytes change', async () => {
    const root = await mkGitTestDir('tao-ship-git-provenance-')
    await initGitTestRepository(root)
    await git(root, 'config', 'user.email', 'test@example.com')
    await git(root, 'config', 'user.name', 'Tao Test')
    const path = FS.resolvePath('App.tao', root)
    await FS.writeText(path, 'view App() { }\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-qm', 'Initial')

    await FS.writeText(path, 'view App() { Text("one") }\n')
    const first = await inspectShipGit(root)
    const repeated = await inspectShipGit(root)
    await FS.writeText(path, 'view App() { Text("two") }\n')
    const second = await inspectShipGit(root)

    Expect(first.dirtyFingerprint).toBe(repeated.dirtyFingerprint)
    Expect(second.dirtyFingerprint).not.toBe(first.dirtyFingerprint)
  })

  Test('includes untracked executable modes and symlink targets in provenance', async () => {
    const root = await mkGitTestDir('tao-ship-git-file-semantics-')
    await initGitTestRepository(root)
    await git(root, 'config', 'user.email', 'test@example.com')
    await git(root, 'config', 'user.name', 'Tao Test')
    await FS.writeText(FS.resolvePath('Tracked.tao', root), 'view App() { }\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-qm', 'Initial')
    const executable = FS.resolvePath('tool', root)
    const targetOne = FS.resolvePath('target-one', root)
    const targetTwo = FS.resolvePath('target-two', root)
    const link = FS.resolvePath('selected', root)
    await FS.writeText(executable, 'same bytes\n')
    await FS.writeText(targetOne, 'same target bytes\n')
    await FS.writeText(targetTwo, 'same target bytes\n')
    await FS.symlink('target-one', link)
    const initial = await inspectShipGit(root)

    await FS.chmod(executable, 0o755)
    const executableChanged = await inspectShipGit(root)
    await FS.remove(link)
    await FS.symlink('target-two', link)
    const linkChanged = await inspectShipGit(root)

    Expect(executableChanged.dirtyFingerprint).not.toBe(initial.dirtyFingerprint)
    Expect(linkChanged.dirtyFingerprint).not.toBe(executableChanged.dirtyFingerprint)
  })

  Test('allows projects outside git', async () => {
    const root = await mkTestDir('tao-ship-no-git-', { location: 'host' })
    try {
      const state = await inspectShipGit(root)
      Expect(state).toEqual({ commit: 'unversioned', dirty: false })
      Expect(shipSourceMatchesBuild(state, state)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('retries when HEAD changes while provenance is being captured', async () => {
    const commits = ['before-change', 'after-change', 'stable', 'stable']
    const runner = (async (_command: string, spec = {}) => {
      const args = 'args' in spec && Array.isArray(spec.args) ? spec.args : []
      const stdout = args.includes('--show-toplevel')
        ? '/repo\n'
        : args.includes('rev-parse')
        ? `${commits.shift()}\n`
        : ''
      return {
        args: [...args],
        command: 'git',
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout,
      }
    }) as typeof CLI.run

    Expect(await inspectShipGit('/repo', {}, runner)).toEqual({
      commit: 'stable',
      dirty: false,
      root: '/repo',
    })
    Expect(commits).toEqual([])
  })

  Test('reuses a build across Tao lock checkpoints but not source commits', async () => {
    const root = await mkGitTestDir('tao-ship-git-reuse-')
    await initGitTestRepository(root)
    await git(root, 'config', 'user.email', 'test@example.com')
    await git(root, 'config', 'user.name', 'Tao Test')
    const sourcePath = FS.resolvePath('App.tao', root)
    const lockPath = FS.resolvePath('.tao-project/lock.jsonc', root)
    await FS.writeText(sourcePath, 'project { version "1.0.0" }\n')
    await FS.writeText(lockPath, '{"schemaVersion":1}\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-qm', 'Source build')
    const built = await inspectShipGit(root)

    await FS.writeText(lockPath, '{"schemaVersion":1,"ship":{}}\n')
    Expect(shipSourceMatchesBuild(await inspectShipGit(root, { excludePaths: [lockPath] }), built)).toBe(true)

    await FS.writeText(sourcePath, 'project { version "1.0.0" }\n// changed\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-qm', 'Change source')
    Expect(shipSourceMatchesBuild(await inspectShipGit(root, { excludePaths: [lockPath] }), built)).toBe(false)
  })
})
