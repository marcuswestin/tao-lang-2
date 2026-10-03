import { FS } from '@shared'
import { Deferred, Expect, mkTestDir, Test } from '@shared/test'
import { createRecentProjectStore } from '../studio-tooling-src/StudioDev'
import { prepareStudioHome, withStudioRecentsLock } from '../studio-tooling-src/StudioHome'

Test('Studio home migration preserves current files, unknown entries, and repeated preparation', async () => {
  const taskRoot = await mkTestDir('studio-home-')
  const home = FS.resolvePath('home', taskRoot)
  const legacy = FS.resolvePath('legacy', taskRoot)
  try {
    await FS.writeText(FS.resolvePath('recent-projects.json', legacy), 'legacy recent')
    await FS.writeText(FS.resolvePath('launches/old.json', legacy), 'legacy launch')
    await FS.writeText(FS.resolvePath('unknown.txt', legacy), 'unknown')
    await FS.writeText(FS.resolvePath('studio/recent-projects.json', home), 'current recent')
    await Promise.all([prepareStudioHome(legacy, home), prepareStudioHome(legacy, home)])
    await prepareStudioHome(legacy, home)
    Expect(await FS.readText(FS.resolvePath('studio/recent-projects.json', home))).toBe('current recent')
    Expect(await FS.readText(FS.resolvePath('recent-projects.json', legacy))).toBe('legacy recent')
    Expect(await FS.readText(FS.resolvePath('studio/launches/old.json', home))).toBe('legacy launch')
    Expect(await FS.exists(FS.resolvePath('launches/old.json', legacy))).toBe(false)
    Expect(await FS.readText(FS.resolvePath('unknown.txt', legacy))).toBe('unknown')
    Expect(await FS.exists(FS.resolvePath('studio/migrations/recents', home))).toBe(false)
  } finally {
    await FS.remove(taskRoot)
  }
})

Test('Studio home migration merges recent projects from another worktree once', async () => {
  const taskRoot = await mkTestDir('studio-home-recents-')
  const home = FS.resolvePath('home', taskRoot)
  const legacy = FS.resolvePath('legacy', taskRoot)
  const path = FS.resolvePath('studio/recent-projects.json', home)
  const newer = { appName: 'App', project: '/new', lastOpenedAt: '2026-10-03T12:00:00Z' }
  const older = { appName: 'App', project: '/old', lastOpenedAt: '2026-10-02T12:00:00Z' }
  try {
    await FS.writeJson(path, { version: 1, recent: [newer] })
    await FS.writeJson(FS.resolvePath('recent-projects.json', legacy), { version: 1, recent: [older] })
    await prepareStudioHome(legacy, home)
    Expect(await FS.readJson(path)).toEqual({ version: 1, recent: [newer, older] })
    Expect(await FS.exists(FS.resolvePath('recent-projects.json', legacy))).toBe(false)
    Expect((await FS.listDir(FS.resolvePath('studio/migrations/recents', home))).length).toBe(1)
    await FS.writeJson(path, { version: 1, recent: [newer] })
    await prepareStudioHome(legacy, home)
    Expect(await FS.readJson(path)).toEqual({ version: 1, recent: [newer] })
  } finally {
    await FS.remove(taskRoot)
  }
})

Test('Studio migration and a concurrent save merge under the same home lock', async () => {
  const taskRoot = await mkTestDir('studio-home-recents-race-')
  const home = FS.resolvePath('home', taskRoot)
  const legacy = FS.resolvePath('legacy', taskRoot)
  const path = FS.resolvePath('studio/recent-projects.json', home)
  const current = { appName: 'App', project: '/current', lastOpenedAt: '2026-10-01T12:00:00Z' }
  const older = { appName: 'App', project: '/legacy', lastOpenedAt: '2026-10-02T12:00:00Z' }
  const latest = { appName: 'App', project: '/new', lastOpenedAt: '2026-10-03T12:00:00Z' }
  const release = Deferred()
  const entered = Deferred()
  await FS.writeJson(path, { version: 1, recent: [current] })
  await FS.writeJson(FS.resolvePath('recent-projects.json', legacy), { version: 1, recent: [older] })
  const holding = withStudioRecentsLock(path, async () => {
    entered.resolve()
    await release.promise
  })
  const store = createRecentProjectStore(path)
  let migration: Promise<string> | undefined
  let saving: Promise<void> | undefined
  try {
    await entered.promise
    migration = prepareStudioHome(legacy, home)
    saving = store.save([latest])
    release.resolve()
    await Promise.all([holding, migration, saving])
    Expect(await FS.readJson(path)).toEqual({ version: 1, recent: [latest, older, current] })
    Expect(await FS.exists(FS.resolvePath('recent-projects.json', legacy))).toBe(false)
    Expect((await FS.listDir(FS.resolvePath('studio/migrations/recents', home))).length).toBe(1)
    Expect(await FS.listDir(FS.resolvePath('cache/studio/tmp', home))).toEqual([])
  } finally {
    release.resolve()
    await Promise.allSettled([holding, migration, saving, store.flush()])
    await FS.remove(taskRoot)
  }
})
