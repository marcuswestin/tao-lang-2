import { CLI, FS } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'
import { projectsNeedingInstall } from '../dev-cli-src/setup/TaoProjectDependencies'

Describe('setup: Tao project dependencies', () => {
  Test('lists a tracked project only until its installed packages match the lock pins', async () => {
    const root = await mkGitTestDir('tao-project-dependencies-')
    try {
      const pinned = { name: 'date-fns', requested: '^4.0.0', version: '4.1.0' }
      const lock = (npm: object) => ({
        schemaVersion: 1,
        installs: { lockfileVersion: 2, local: {}, environments: { '.': { projectRoot: '.', publications: [], npm } } },
      })
      await FS.writeJson(FS.resolvePath('Apps/Pinned/.tao/lock.jsonc', root), lock({ util: pinned }))
      await FS.writeJson(FS.resolvePath('Apps/Plain/.tao/lock.jsonc', root), lock({}))
      await FS.writeJson(FS.resolvePath('Apps/Untracked/.tao/lock.jsonc', root), lock({ util: pinned }))
      await initGitTestRepository(root)
      await CLI.mustRun('git', { args: ['add', 'Apps/Pinned', 'Apps/Plain'], cwd: root })

      Expect(await projectsNeedingInstall(root)).toEqual(['Apps/Pinned'])
      const manifest = FS.resolvePath('Apps/Pinned/node_modules/util/package.json', root)
      await FS.writeJson(manifest, { name: 'date-fns', version: '4.0.0' })
      Expect(await projectsNeedingInstall(root)).toEqual(['Apps/Pinned'])
      await FS.writeJson(manifest, { name: 'date-fns', version: '4.1.0' })
      Expect(await projectsNeedingInstall(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })
})
