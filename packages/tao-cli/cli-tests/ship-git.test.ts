import { CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  commitShipState,
  commitShipVersion,
  inspectShipGit,
  shipNotesSince,
  shipSourceMatchesBuild,
  tagShipVersion,
} from '../cli-src/ship-git'

async function git(root: string, ...args: string[]): Promise<string> {
  return (await CLI.mustRun('git', { args: ['-C', root, ...args] })).stdout.trim()
}

Describe('tao ship git behavior', () => {
  Test('checks dirtiness, commits the bump, tags store releases, and derives notes', async () => {
    const root = await mkTestDir('tao-ship-git-')
    try {
      await git(root, 'init', '-q')
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

      await FS.writeText(projectPath, 'project { version "1.0.1" }\n')
      await FS.writeText(lockPath, '{"schemaVersion":1,"ship":{}}\n')
      Expect((await inspectShipGit(root)).dirty).toBe(true)
      const commit = await commitShipVersion(clean, [projectPath, lockPath], '1.0.1')
      await tagShipVersion({ ...clean, commit }, '1.0.1')
      Expect(await git(root, 'tag', '--list')).toBe('v1.0.1')
      Expect(await shipNotesSince({ ...clean, commit })).toContain('Bump app version')
      Expect((await inspectShipGit(root)).dirty).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('allows projects outside git', async () => {
    const root = await mkTestDir('tao-ship-no-git-')
    try {
      Expect(await inspectShipGit(root)).toEqual({ commit: 'unversioned', dirty: false })
    } finally {
      await FS.remove(root)
    }
  })

  Test('reuses a build across Tao lock checkpoints but not source commits', async () => {
    const root = await mkTestDir('tao-ship-git-reuse-')
    try {
      await git(root, 'init', '-q')
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
      await commitShipState(built, lockPath, 'Record ship state')
      Expect(await shipSourceMatchesBuild(await inspectShipGit(root), built.commit, lockPath)).toBe(true)

      await FS.writeText(sourcePath, 'project { version "1.0.0" }\n// changed\n')
      await git(root, 'add', '.')
      await git(root, 'commit', '-qm', 'Change source')
      Expect(await shipSourceMatchesBuild(await inspectShipGit(root), built.commit, lockPath)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
})
