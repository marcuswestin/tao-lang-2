import { Errors, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { StudioApiEventStream } from '../studio-src/client/StudioApiClient'
import type { StudioFixtureGeneration } from '../studio-src/StudioFixtureGeneration'
import { StudioProjectSession, type StudioSessionEvent } from '../studio-src/StudioProjectSession'
import { StudioServerTesting } from '../studio-src/StudioServer'
import { StudioSketchCatalogConflictError, type StudioSketchCatalogRequest } from '../studio-src/StudioSketchCatalog'

Describe('Studio sketch session protocol', () => {
  Test(
    'creates source and catalog once, publishes capability, and replays a retry without another compile',
    async () => {
      await withSketchSession(async (session, root, compiles) => {
        const events: StudioSessionEvent[] = []
        session.subscribe(event => events.push(event))
        const request = createRequest(root, 'create-1')

        const created = await session.applySketchAction(request)
        const retried = await session.applySketchAction(request)

        Expect(retried).toEqual(created)
        Expect(compiles).toHaveLength(1)
        Expect(created.createdSketch).toMatchObject({ name: 'View1', project: root, view: 'View1' })
        Expect(created.generatedFile?.path).toBe('@/studio/View1.tao')
        Expect(await FS.readText(FS.resolvePath('@/studio/View1.tao', root))).toContain('public\nview View1()')
        Expect(events.filter(event => event.type === 'sketch-catalog-changed')).toHaveLength(1)
        const handshake = await session.handshake()
        Expect(handshake.capabilities.sketches).toEqual({ catalogVersion: 1, freeGeometry: true })
        Expect(handshake.sketchCatalog).toEqual(created.catalog)
        Expect(handshake.endpoints).toContainEqual({ method: 'GET', path: '/api/sketches' })
        Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/sketches/action' })
      })
    },
  )

  Test('rejects stale revisions and cross-project create requests', async () => {
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction(createRequest(root, 'create-1'))
      const rect = created.catalog.sketches[0]!.rects[0]!
      await Expect(session.applySketchAction({
        action: { kind: 'update-rect', rect, rectId: rect.id, sketchId: 'sketch-1' },
        expectedRevision: 0,
        requestId: 'stale',
      })).rejects.toBeInstanceOf(StudioSketchCatalogConflictError)
      await Expect(session.applySketchAction(createRequest('/another/project', 'foreign'))).rejects.toThrow(
        'only be created in the active project',
      )
    })
  })

  Test('changes rectangle data without rewriting or recompiling generated Tao', async () => {
    await withSketchSession(async (session, root, compiles) => {
      const created = await session.applySketchAction(createRequest(root, 'create-1'))
      const path = FS.resolvePath('@/studio/View1.tao', root)
      const source = await FS.readText(path)
      const rect = created.catalog.sketches[0]!.rects[0]!

      const updated = await session.applySketchAction({
        action: {
          kind: 'update-rect',
          rect: { ...rect, content: 'Updated', x: 40 },
          rectId: rect.id,
          sketchId: 'sketch-1',
        },
        expectedRevision: created.catalog.revision,
        requestId: 'rect-update',
      })

      Expect(updated.catalog.sketches[0]!.rects[0]).toMatchObject({ content: 'Updated', x: 40 })
      Expect(await FS.readText(path)).toBe(source)
      Expect(compiles).toHaveLength(1)
    })
  })

  Test(
    'restores the exact catalog and removes only the new source after compile failure, then permits retry',
    async () => {
      let fail = true
      await withSketchSession(async (session, root, compiles) => {
        const before = await session.sketchCatalog()
        const request = createRequest(root, 'retry-after-failure')
        const events: StudioSessionEvent[] = []
        session.subscribe(event => events.push(event))

        await Expect(session.applySketchAction(request)).rejects.toThrow('generated source failed to compile')
        Expect(await session.sketchCatalog()).toEqual(before)
        Expect(await FS.exists(FS.resolvePath('@/studio/View1.tao', root))).toBe(false)
        Expect(compiles).toHaveLength(2)
        Expect(events.some(event => event.type === 'file-changed' || event.type === 'files-changed')).toBe(false)
        Expect(events.some(event => event.type === 'sketch-catalog-changed')).toBe(false)

        fail = false
        const retried = await session.applySketchAction(request)
        Expect(retried.createdSketch?.name).toBe('View1')
        Expect(await FS.isFile(FS.resolvePath('@/studio/View1.tao', root))).toBe(true)
      }, () => {
        if (fail) {
          throw new Errors.UserInputError('Generated preview is invalid.')
        }
      })
    },
  )

  Test('routes catalog snapshots/actions and dispatches catalog events through the typed client boundary', async () => {
    const snapshot = { formatVersion: 1 as const, nextViewNumber: 1, revision: 0, sketches: [] }
    const actions: unknown[] = []
    const session = {
      async applySketchAction(input: unknown) {
        actions.push(input)
        return { catalog: snapshot, requestId: 'request-1' }
      },
      async sketchCatalog() {
        return snapshot
      },
      subscribe: () => () => {},
    } as unknown as StudioProjectSession
    const getUrl = new URL('http://127.0.0.1:5678/api/sketches')
    const actionUrl = new URL('http://127.0.0.1:5678/api/sketches/action')
    const action = { action: { id: 'sketch-1', kind: 'delete-sketch' }, expectedRevision: 0, requestId: 'request-1' }
    const getResponse = await StudioServerTesting.handleRequest(
      session,
      {} as StudioFixtureGeneration,
      new Request(getUrl),
      getUrl,
      {},
    )
    const postResponse = await StudioServerTesting.handleRequest(
      session,
      {} as StudioFixtureGeneration,
      new Request(actionUrl, {
        body: JSON.stringify(action),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      actionUrl,
      {},
    )
    let received: unknown
    StudioApiEventStream.dispatch(
      { catalog: snapshot, type: 'sketch-catalog-changed' },
      {
        onCompile() {},
        onDisconnect() {},
        onFile() {},
        onManifest() {},
        onSketchCatalog(catalog) {
          received = catalog
        },
      },
    )

    Expect(await getResponse.json()).toEqual(snapshot)
    Expect(await postResponse.json()).toEqual({ catalog: snapshot, requestId: 'request-1' })
    Expect(actions).toEqual([action])
    Expect(received).toBe(snapshot)

    const conflict = StudioServerTesting.errorResponse(
      new Request(actionUrl),
      actionUrl,
      {},
      new StudioSketchCatalogConflictError(2, 4),
    )
    Expect(conflict.status).toBe(409)
    Expect(await conflict.json()).toEqual({
      details: { actualRevision: 4, code: 'stale-sketch-catalog', expectedRevision: 2 },
      error: 'The Studio sketch catalog changed before this edit was applied.',
    })
  })

  Test('classifies malformed action input as a user-facing 400 without a raw TypeError', async () => {
    await withSketchSession(async session => {
      let failure: unknown
      try {
        await session.applySketchAction({ requestId: 'malformed' })
      } catch (error) {
        failure = error
      }
      Expect(failure).toBeInstanceOf(Errors.UserInputError)
      Expect(failure).not.toBeInstanceOf(TypeError)
      const url = new URL('http://127.0.0.1:5678/api/sketches/action')
      const response = StudioServerTesting.errorResponse(new Request(url), url, {}, failure)
      Expect(response.status).toBe(400)
    })
  })

  Test('does not expose sketch deletion until generated-source cleanup is transactional', async () => {
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction(createRequest(root, 'create-1'))
      await Expect(session.applySketchAction({
        action: { id: 'sketch-1', kind: 'delete-sketch' },
        expectedRevision: created.catalog.revision,
        requestId: 'delete-1',
      })).rejects.toThrow('not available until its generated-source lifecycle lands')
      Expect(await FS.isFile(FS.resolvePath('@/studio/View1.tao', root))).toBe(true)
      Expect((await session.sketchCatalog()).sketches).toHaveLength(1)
    })
  })
})

function createRequest(project: string, requestId: string): StudioSketchCatalogRequest {
  return {
    action: {
      height: 76,
      id: 'sketch-1',
      kind: 'create-sketch',
      project,
      rects: [{ content: 'Cover art', height: 52, id: 'cover', kind: 'Placeholder', width: 52, x: 12, y: 12 }],
      width: 360,
    },
    expectedRevision: 0,
    requestId,
  }
}

async function withSketchSession(
  use: (session: StudioProjectSession, root: string, compiles: unknown[]) => Promise<void>,
  compile: () => void = () => {},
): Promise<void> {
  await withTaoFiles('tao-studio-sketch-session-', {
    'Garden.tao': 'app Garden { view Main }\nview Main() { }\n',
  }, async (paths, root) => {
    const compiles: unknown[] = []
    const session = await StudioProjectSession.open({
      async compile(request) {
        compiles.push(request)
        compile()
      },
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    await use(session, await FS.realPath(root), compiles)
  })
}
