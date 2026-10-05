import { FS, Platform, TaoHome } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('Tao home agent state migration', () => {
  Test('moves recognized files to a literal app ID and preserves conflicts and unknown entries', async () => {
    const root = await mkTestDir('tao-agent-home-')
    const appId = 'My.App-1'
    const agentsRoot = FS.resolvePath('agents', root)
    const olderRoot = FS.resolvePath('legacy', root)
    const hashRoot = FS.resolvePath(Platform.sha256Hex(appId).slice(0, 24), olderRoot)
    const appRoot = FS.resolvePath(appId, agentsRoot)
    try {
      await FS.writeText(FS.resolvePath('origin.json', hashRoot), '{ "origin": "old" }')
      await FS.writeText(FS.resolvePath('session.json', hashRoot), '{ "session": "old" }')
      await FS.writeText(FS.resolvePath('service.log', hashRoot), 'old service')
      await FS.writeText(FS.resolvePath('unknown.json', hashRoot), 'leave me')
      await FS.writeText(FS.resolvePath('session.json', appRoot), '{ "session": "current" }')

      Expect(await TaoHome.prepareAgentState(appId, agentsRoot, olderRoot)).toBe(appRoot)
      Expect(await TaoHome.prepareAgentState(appId, agentsRoot, olderRoot)).toBe(appRoot)

      Expect(await FS.readText(FS.resolvePath('origin.json', appRoot))).toBe('{ "origin": "old" }')
      Expect(await FS.readText(FS.resolvePath('service.log', appRoot))).toBe('old service')
      Expect(await FS.readText(FS.resolvePath('session.json', appRoot))).toBe('{ "session": "current" }')
      Expect(await FS.readText(FS.resolvePath('session.json', hashRoot))).toBe('{ "session": "old" }')
      Expect(await FS.readText(FS.resolvePath('unknown.json', hashRoot))).toBe('leave me')
      Expect(await FS.listDir(FS.resolvePath('cache/agents/locks', root))).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses unsafe app IDs before resolving or creating app directories', async () => {
    const root = await mkTestDir('tao-agent-home-invalid-')
    try {
      for (const appId of ['../escape', 'a/b', '.hidden', 'bad_id', 'bad..id', '']) {
        await Expect(TaoHome.prepareAgentState(appId, FS.resolvePath('agents', root), FS.resolvePath('legacy', root)))
          .rejects.toThrow('Invalid Tao agent app ID')
      }
      Expect(await FS.listDir(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('leaves a legacy symbolic link in place', async () => {
    const root = await mkTestDir('tao-agent-home-link-')
    const appId = 'Other.App'
    const agentsRoot = FS.resolvePath('agents', root)
    const olderRoot = FS.resolvePath('legacy', root)
    const hashRoot = FS.resolvePath(Platform.sha256Hex(appId).slice(0, 24), olderRoot)
    try {
      await FS.writeText(FS.resolvePath('target.json', root), 'outside')
      await FS.symlink(FS.resolvePath('target.json', root), FS.resolvePath('origin.json', hashRoot))

      const appRoot = await TaoHome.prepareAgentState(appId, agentsRoot, olderRoot)

      Expect(await FS.isSymbolicLink(FS.resolvePath('origin.json', hashRoot))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('origin.json', appRoot))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('target.json', root))).toBe('outside')
    } finally {
      await FS.remove(root)
    }
  })
})
