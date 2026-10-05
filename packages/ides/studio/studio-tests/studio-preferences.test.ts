import { FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioWorkbenchState } from '../studio-src/client/StudioShell'
import { StudioPreferencesStore } from '../studio-src/StudioPreferencesStore'
import { startStudioSessionServer } from '../studio-src/StudioServer'
import { StudioSessionManager } from '../studio-src/StudioSessionManager'

Test('Studio home preferences merge independent window writes and import only missing browser values', async () => {
  const home = await mkTestDir('studio-preferences-')
  const studio = FS.resolvePath('studio', home)
  const firstWindow = new StudioPreferencesStore(studio)
  const secondWindow = new StudioPreferencesStore(studio)

  Expect(await firstWindow.read()).toEqual({})
  await firstWindow.save({ 'tao-studio:layout-preset:v1': 'design' })
  await secondWindow.save({ 'tao-studio:drawer-tab:v1': 'Tests' })
  await firstWindow.save({
    'tao-studio:drawer-tab:v1': 'Problems',
    'tao-studio:layout-preset:v1': 'run',
    'tao-studio:rail-panel:v1': 'screens',
  }, true)
  Expect(await secondWindow.read()).toEqual({
    'tao-studio:drawer-tab:v1': 'Tests',
    'tao-studio:layout-preset:v1': 'design',
    'tao-studio:rail-panel:v1': 'screens',
  })
  Expect(await FS.readJson(FS.resolvePath('prefs.json', studio))).toEqual({
    version: 1,
    values: await firstWindow.read(),
  })
})

Test('Studio rejects malformed browser preferences without dropping valid home fields', async () => {
  const home = await mkTestDir('studio-preferences-validation-')
  const store = new StudioPreferencesStore(FS.resolvePath('studio', home))
  await store.save({
    'tao-studio:pane-sizes:v4': JSON.stringify({ bottom: 150, left: 300, preview: 450, right: 400 }),
    'tao-studio:layout-preset:v1': 'design',
  })
  await store.save({
    'tao-studio:pane-sizes:v4': JSON.stringify({ bottom: -5, left: 300, preview: 450, right: 400 }),
    'tao-studio:layout-preset:v1': 'invalid',
    'tao-studio.lens': JSON.stringify({ active: ['structure', 'unknown'], version: 1 }),
    'tao-studio:agent-position:v1': JSON.stringify({ left: '123px', top: '40px' }),
  })
  Expect(await store.read()).toEqual({
    'tao-studio:agent-position:v1': JSON.stringify({ left: '123px', top: '40px' }),
    'tao-studio:pane-sizes:v4': JSON.stringify({ bottom: 150, left: 300, preview: 450, right: 400 }),
    'tao-studio:layout-preset:v1': 'design',
  })
})

Test('Studio keeps every supported global preference in the shared home snapshot', async () => {
  const home = await mkTestDir('studio-preferences-keys-')
  const store = new StudioPreferencesStore(FS.resolvePath('studio', home))
  const values = {
    'tao-studio:agent-position:v1': JSON.stringify({ left: 120, top: 45 }),
    'tao-studio:drawer-tab:v1': 'Debug',
    'tao-studio:layout-preset:v1': 'draw',
    'tao-studio:pane-sizes:v4': JSON.stringify({ bottom: 180, left: 360, preview: 440, right: 440 }),
    'tao-studio:rail-panel:v1': 'components',
    'tao-studio.lens': JSON.stringify({ active: ['structure', 'layout'], version: 1 }),
  }
  Expect(await store.save(values, true)).toEqual(values)
  Expect(await store.read()).toEqual(values)
  Expect(StudioWorkbenchState.loadDrawerTab({ getItem: key => values[key as keyof typeof values] ?? null })).toBe(
    'Debug',
  )
})

Test('Studio ignores an older write from the same window after a newer keepalive write', async () => {
  const home = await mkTestDir('studio-preferences-order-')
  const store = new StudioPreferencesStore(FS.resolvePath('studio', home))
  const writer = { id: 'window-one', sequence: 2 }
  await store.save({ 'tao-studio:drawer-tab:v1': 'Debug' }, false, writer)
  await store.save({ 'tao-studio:drawer-tab:v1': 'Problems' }, false, { ...writer, sequence: 1 })
  Expect(await store.read()).toEqual({ 'tao-studio:drawer-tab:v1': 'Debug' })
})

Test('Studio preference HTTP route works with no current project and keeps same-origin checks', async () => {
  const home = await mkTestDir('studio-preferences-http-')
  const preferencesRoot = FS.resolvePath('studio', home)
  const server = await startStudioSessionServer(new StudioSessionManager(), { compileOnStart: false, preferencesRoot })
  try {
    const url = `${server.url}/api/studio/preferences`
    const save = await fetch(url, {
      body: JSON.stringify({ values: { 'tao-studio:drawer-tab:v1': 'Debug' } }),
      headers: { 'content-type': 'application/json', origin: server.url },
      method: 'POST',
    })
    Expect(save.status).toBe(200)
    Expect(await save.json()).toEqual({ values: { 'tao-studio:drawer-tab:v1': 'Debug' } })
    const read = await fetch(url)
    Expect(read.status).toBe(200)
    Expect(await read.json()).toEqual({ values: { 'tao-studio:drawer-tab:v1': 'Debug' } })
    Expect((await fetch(`${server.url}/sessions/missing/api/studio/preferences`)).status).toBe(404)
    Expect((await fetch(url, { headers: { origin: 'https://another.example' } })).status).toBe(403)
  } finally {
    await server.stop()
  }
})
