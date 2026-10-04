import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { StudioElectrobun } from '../studio-tooling-src/StudioElectrobun'
import { StudioNativeIdentity } from '../studio-tooling-src/StudioNativeIdentity'

const linked = (name: string, realPath = `/code/tao.worktrees/${name}`) =>
  StudioNativeIdentity.of({ linked: true, name, realPath })

Describe('native Studio worktree identity', () => {
  Test('keeps the release identity and host lease for the primary checkout', () => {
    Expect(StudioNativeIdentity.of({ linked: false, name: 'tao-lang-2', realPath: '/code/tao-lang-2' })).toEqual({
      appName: 'Tao Studio',
      bundleIdentifier: 'com.devtao.studio',
      hostResourceName: 'studio-native-host:com.devtao.studio',
    })
  })

  Test('names a linked worktree in its app name, bundle identifier, and host lease', () => {
    const identity = linked('canvas-figma-thread-overlap-9bc7d7')

    Expect(identity.appName).toBe('Tao Studio — canvas-figma-thread-overlap-9bc7d7')
    Expect(identity.bundleIdentifier).toMatch(/^com\.devtao\.studio\.canvas-figma-thread-overlap-9bc7d7-[0-9a-f]{8}$/)
    Expect(identity.hostResourceName).toBe(`studio-native-host:${identity.bundleIdentifier}`)
    Expect(linked('canvas-figma-thread-overlap-9bc7d7')).toEqual(identity)
  })

  Test('separates two worktrees that share a directory name', () => {
    const first = linked('studio', '/code/first.worktrees/studio')
    const second = linked('studio', '/code/second.worktrees/studio')

    Expect(first.appName).toBe(second.appName)
    Expect(first.bundleIdentifier).not.toBe(second.bundleIdentifier)
  })

  Test('reduces any directory name to a bundle identifier Electrobun accepts', () => {
    const names = [
      'Feature_Branch v2',
      '.hidden--name.',
      'naïve café ☕',
      '☕☕',
      'a'.repeat(120),
    ]
    const identities = names.map(name => linked(name))

    Expect(identities.map(identity => identity.bundleIdentifier.replace(/-[0-9a-f]{8}$/, ''))).toEqual([
      'com.devtao.studio.feature-branch-v2',
      'com.devtao.studio.hidden-name',
      'com.devtao.studio.na-ve-caf',
      'com.devtao.studio.worktree',
      `com.devtao.studio.${'a'.repeat(40)}`,
    ])
    const identity = identities[2]!
    const sources = StudioElectrobun.sources({
      appName: identity.appName,
      bundleIdentifier: identity.bundleIdentifier,
      outputRoot: '/tmp/unused-by-source-tests',
      previewUrl: 'http://127.0.0.1:8081',
      studioUrl: 'http://127.0.0.1:55101',
    })
    Expect(sources.config).toContain(`identifier: ${JSON.stringify(identity.bundleIdentifier)}`)
  })

  Test('reads a linked worktree from its .git file and the primary checkout from its .git directory', async () => {
    const root = await mkTestDir('tao-studio-native-identity-')
    try {
      const primary = FS.resolvePath('tao', root)
      const worktree = FS.resolvePath('tao.worktrees/feature-a', root)
      await FS.mkdir(FS.resolvePath('.git', primary))
      await FS.mkdir(worktree)
      await FS.writeText(FS.resolvePath('.git', worktree), `gitdir: ${primary}/.git/worktrees/feature-a\n`)

      Expect((await StudioNativeIdentity.forWorktree(primary)).bundleIdentifier).toBe('com.devtao.studio')
      Expect(await StudioNativeIdentity.forWorktree(worktree)).toEqual(
        StudioNativeIdentity.of({ linked: true, name: 'feature-a', realPath: await FS.realPath(worktree) }),
      )
    } finally {
      await FS.remove(root)
    }
  })
})
