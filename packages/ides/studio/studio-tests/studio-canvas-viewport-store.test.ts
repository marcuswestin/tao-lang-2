import { Errors, FS } from '@shared'
import { Deferred, Expect, mkTestDir, settle, Test, withTaoFiles } from '@shared/test'
import { StudioCanvasViewportStore } from '../studio-src/StudioCanvasViewportStore'
import { StudioProjectSession } from '../studio-src/StudioProjectSession'
import { startStudioSessionServer } from '../studio-src/StudioServer'
import { StudioSessionManager } from '../studio-src/StudioSessionManager'

Test('Studio server teardown drains accepted viewport writes', async () => {
  const state = await mkTestDir('studio-viewport-teardown-')
  const writing = Deferred<void>()
  const release = Deferred<void>()
  const store = new StudioCanvasViewportStore(state, {
    ...FS,
    async move(from, to) {
      writing.resolve()
      await release.promise
      await FS.move(from, to)
    },
  })
  await withTaoFiles(
    'studio-viewport-teardown-project-',
    { 'Garden.tao': 'app Garden { Text("Hello") }\n' },
    async (_paths, root) => {
      const session = await StudioProjectSession.open({ compile: async () => {}, projectRoot: root })
      const manager = new StudioSessionManager({ createSessionId: () => 'teardown_session' })
      manager.add({ session })
      const server = await startStudioSessionServer(manager, { canvasViewportStore: store, compileOnStart: false })
      const saving = session.saveCanvasViewport({
        clientId: 'window',
        sequence: 1,
        viewport: { x: 6, y: 7, z: 0.4 },
      })
      await writing.promise
      let stopped = false
      const stopping = Promise.resolve(server.stop()).then(() => {
        stopped = true
      })
      try {
        await settle()
        Expect(stopped).toBe(false)
      } finally {
        release.resolve()
        await Promise.all([saving, stopping])
      }
      Expect(await new StudioCanvasViewportStore(state).load(root)).toEqual({ x: 6, y: 7, z: 0.4 })
    },
  )
})

Test('canvas viewport state survives store recreation, separates projects, and canonicalizes aliases', async () => {
  const root = await mkTestDir('studio-viewport-store-')
  const first = FS.resolvePath('first', root)
  const second = FS.resolvePath('second', root)
  const alias = FS.resolvePath('alias', root)
  const state = FS.resolvePath('state', root)
  await FS.mkdir(first)
  await FS.mkdir(second)
  await FS.symlink(first, alias)
  const store = new StudioCanvasViewportStore(state)
  Expect(await store.load(first)).toBe(undefined)
  await store.save(first, { x: -241, y: 39, z: 2.5 })
  await store.save(second, { x: 900, y: -50, z: 0.6 })
  const reopened = new StudioCanvasViewportStore(state)
  Expect(await reopened.load(alias)).toEqual({ x: -241, y: 39, z: 2.5 })
  Expect(await reopened.load(second)).toEqual({ x: 900, y: -50, z: 0.6 })
  await reopened.save(alias, { x: 7, y: 8, z: 1 })
  Expect(await store.load(first)).toEqual({ x: 7, y: 8, z: 1 })
  Expect(await FS.listDir(first)).toEqual([])
  Expect(await FS.listDir(second)).toEqual([])
  const files = await FS.listDir(state)
  Expect(files.length).toBe(2)
})

Test(
  'canvas viewport state validates coordinates, clamps zoom, and ignores corrupt or unsupported records',
  async () => {
    const root = await mkTestDir('studio-viewport-validation-')
    const state = FS.resolvePath('state', root)
    const store = new StudioCanvasViewportStore(state)
    for (const value of [null, {}, { x: Infinity, y: 0, z: 1 }, { x: 0, y: '2', z: 1 }]) {
      Expect(() => StudioCanvasViewportStore.normalize(value)).toThrow('Expected finite canvas viewport')
    }
    await store.save(root, { x: 5, y: 10, z: 8 })
    Expect(await store.load(root)).toEqual({ x: 5, y: 10, z: 4 })
    await store.save(root, { x: 5, y: 10, z: -2 })
    Expect(await store.load(root)).toEqual({ x: 5, y: 10, z: 0.1 })
    const path = FS.resolvePath((await FS.listDir(state))[0]!, state)
    Expect(await FS.readJson(path)).toEqual({ version: 1, viewport: { x: 5, y: 10, z: 0.1 } })
    for (const text of ['{', '{"version":2,"viewport":{"x":1,"y":2,"z":1}}', '{"version":1,"viewport":{"x":1}}']) {
      await FS.writeText(path, text)
      Expect(await store.load(root)).toBe(undefined)
    }
  },
)

Test('canvas viewport writes serialize before atomic replacement and flush waits for the latest save', async () => {
  const root = await mkTestDir('studio-viewport-order-')
  const state = FS.resolvePath('state', root)
  const firstMove = Deferred<void>()
  const release = Deferred<void>()
  const moves: string[] = []
  let starts = 0
  const store = new StudioCanvasViewportStore(state, {
    ...FS,
    // Make canonicalization deterministic so draining the queue proves whether a second write began.
    realPath: async () => root,
    async writeJson(path, value) {
      starts++
      await FS.writeJson(path, value)
    },
    async move(from, to) {
      moves.push(from)
      if (moves.length === 1) {
        firstMove.resolve()
        await release.promise
      }
      await FS.move(from, to)
    },
  })
  const first = store.save(root, { x: 1, y: 1, z: 1 })
  await firstMove.promise
  const second = store.save(root, { x: 2, y: 2, z: 2 })
  const flushing = store.flush()
  const settled: string[] = []
  void flushing.then(() => settled.push('flushed'))
  try {
    await settle()
    Expect(starts).toBe(1)
    Expect(settled).toEqual([])
    Expect((await FS.listDir(state)).every(path => path.endsWith('.tmp'))).toBe(true)
  } finally {
    release.resolve()
  }
  await Promise.all([first, second, flushing])
  Expect(await new StudioCanvasViewportStore(state).load(root)).toEqual({ x: 2, y: 2, z: 2 })
  Expect((await FS.listDir(state)).length).toBe(1)
  Expect(moves[0]).not.toBe(moves[1])
})

Test('canvas viewport saves recover after a failed write without leaving temporary files', async () => {
  const root = await mkTestDir('studio-viewport-failure-')
  const state = FS.resolvePath('state', root)
  let fail = true
  const store = new StudioCanvasViewportStore(state, {
    ...FS,
    async move(from, to) {
      if (fail) {
        fail = false
        Errors.throwHostEnvironment('Viewport write failed.')
      }
      await FS.move(from, to)
    },
  })
  await Expect(store.save(root, { x: 1, y: 1, z: 1 })).rejects.toThrow('Viewport write failed.')
  Expect(await FS.listDir(state)).toEqual([])
  await store.save(root, { x: 2, y: 2, z: 2 })
  await store.flush()
  Expect(await store.load(root)).toEqual({ x: 2, y: 2, z: 2 })
})

Test(
  'session canvas endpoint restores preferences and ignores stale saves without compiling or revising sketches',
  async () => {
    const state = await mkTestDir('studio-viewport-session-state-')
    await withTaoFiles(
      'studio-viewport-session-',
      { 'Garden.tao': 'app Garden { Text("Hello") }\n' },
      async (_paths, root) => {
        let compiles = 0
        const open = () =>
          StudioProjectSession.open({
            compile: async () => {
              compiles++
            },
            projectRoot: root,
          })
        const session = await open()
        const initial = await session.handshake()
        const events: unknown[] = []
        session.subscribe(event => events.push(event))
        const manager = new StudioSessionManager({ createSessionId: () => 'canvas_session' })
        manager.add({ session })
        const server = await startStudioSessionServer(manager, {
          canvasViewportStore: new StudioCanvasViewportStore(state),
          compileOnStart: false,
        })
        const endpoint = `${server.url}/sessions/canvas_session/api/canvas/viewport`
        const post = (body: unknown, origin = server.url) =>
          fetch(endpoint, {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json', origin },
            method: 'POST',
          })
        try {
          const newest = { clientId: 'window-one', sequence: 2, viewport: { x: 120, y: -40, z: 1.8 } }
          Expect((await post(newest, 'https://hostile.example')).status).toBe(403)
          Expect((await post({ ...newest, viewport: { x: 1, y: null, z: 1 } })).status).toBe(400)
          Expect(await (await post(newest)).json()).toEqual({ x: 120, y: -40, z: 1.8 })
          Expect(await (await post({ ...newest, sequence: 1, viewport: { x: 1, y: 2, z: 1 } })).json())
            .toEqual({ x: 120, y: -40, z: 1.8 })
          const handshake = await (await fetch(`${server.url}/sessions/canvas_session/api/protocol`)).json()
          Expect(handshake.canvasViewport).toEqual({ x: 120, y: -40, z: 1.8 })
          Expect((await session.sketchCatalog()).revision).toBe(initial.sketchCatalog.revision)
          Expect(compiles).toBe(0)
          Expect(events).toEqual([])
        } finally {
          await server.stop()
        }
        const reopened = await open()
        reopened.setCanvasViewportStore(new StudioCanvasViewportStore(state))
        Expect((await reopened.handshake()).canvasViewport).toEqual({ x: 120, y: -40, z: 1.8 })
      },
    )
  },
)
