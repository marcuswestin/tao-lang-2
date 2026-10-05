import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { updateStarterFiles } from './test-starter-lowering'

Describe('starter updates', () => {
  Test('keeps the checked-in project identity and local state when regenerating starter source', async () => {
    const root = await mkTestDir('tao-starter-identity-')
    try {
      const source = FS.resolvePath('source', root)
      const target = FS.resolvePath('target', root)
      const original = { id: '550e8400-e29b-41d4-a716-446655440000' }
      const localStatePath = FS.resolvePath('.tao/local/studio/session.json', target)
      const localState = { sessionId: 'private-studio-session' }
      await FS.writeJson(FS.resolvePath('.tao/store/project.json', source), {
        id: '550e8400-e29b-41d4-a716-446655440001',
      })
      await FS.writeText(FS.resolvePath('App.tao', source), 'new app')
      await FS.writeJson(FS.resolvePath('.tao/store/project.json', target), original)
      await FS.writeJson(localStatePath, localState)

      await updateStarterFiles(source, target)

      Expect(await FS.readJson(FS.resolvePath('.tao/store/project.json', target))).toEqual(original)
      Expect(await FS.exists(localStatePath)).toBe(true)
      Expect(await FS.readJson(localStatePath)).toEqual(localState)
      Expect(await FS.readText(FS.resolvePath('App.tao', target))).toBe('new app')
    } finally {
      await FS.remove(root)
    }
  })

  Test(
    'preserves installed dependency links, removes stale authored files, and rejects project links before writing',
    async () => {
      const root = await mkTestDir('tao-starter-update-')
      try {
        const source = FS.resolvePath('source', root)
        const target = FS.resolvePath('target', root)
        const dependency = FS.resolvePath('dependency', root)
        await FS.writeText(FS.resolvePath('App.tao', source), 'new app')
        await FS.writeText(FS.resolvePath('.agents/skill.md', source), 'new skill')
        await FS.writeText(FS.resolvePath('App.tao', target), 'old app')
        await FS.writeText(FS.resolvePath('stale.tao', target), 'stale')
        await FS.writeText(FS.resolvePath('keep.txt', dependency), 'installed dependency')
        const installed = FS.resolvePath('node_modules', target)
        await FS.symlink(dependency, installed)

        await updateStarterFiles(source, target)

        Expect(await FS.isSymbolicLink(installed)).toBe(true)
        Expect(await FS.readText(FS.resolvePath('keep.txt', installed))).toBe('installed dependency')
        Expect(await FS.readText(FS.resolvePath('App.tao', target))).toBe('new app')
        Expect(await FS.readText(FS.resolvePath('.agents/skill.md', target))).toBe('new skill')
        Expect(await FS.exists(FS.resolvePath('stale.tao', target))).toBe(false)

        await FS.writeText(FS.resolvePath('App.tao', source), 'must not publish')
        const unexpected = FS.resolvePath('unexpected', target)
        await FS.symlink(dependency, unexpected)
        await Expect(updateStarterFiles(source, target)).rejects.toThrow('not an ordinary file or directory')
        Expect(await FS.readText(FS.resolvePath('App.tao', target))).toBe('new app')
        Expect(await FS.readText(FS.resolvePath('keep.txt', dependency))).toBe('installed dependency')

        await FS.remove(unexpected)
        await FS.symlink(dependency, FS.resolvePath('unexpected', source))
        await Expect(updateStarterFiles(source, target)).rejects.toThrow('not an ordinary file or directory')
        Expect(await FS.readText(FS.resolvePath('App.tao', target))).toBe('new app')
      } finally {
        await FS.remove(root)
      }
    },
  )
})
