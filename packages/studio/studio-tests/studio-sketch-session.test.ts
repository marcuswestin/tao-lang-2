import { Errors, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { StudioApiEventStream } from '../studio-src/client/StudioApiClient'
import type { StudioFixtureGeneration } from '../studio-src/StudioFixtureGeneration'
import { StudioGeneratedSources } from '../studio-src/StudioGeneratedSources'
import { StudioPreviewManifest } from '../studio-src/StudioPreviewManifest'
import { StudioProjectSession, type StudioSessionEvent } from '../studio-src/StudioProjectSession'
import { studioProtocolChannel, studioProtocolVersion } from '../studio-src/StudioProtocol'
import { StudioServerTesting } from '../studio-src/StudioServer'
import {
  StudioSketchCatalogConflictError,
  type StudioSketchCatalogIO,
  type StudioSketchCatalogRequest,
} from '../studio-src/StudioSketchCatalog'

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
        Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/sketches/flow/action' })
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

  Test('proposes and commits a partial Snap with server-derived tagged render identities', async () => {
    await withSketchSession(async (session, root, compiles) => {
      const created = await session.applySketchAction(createTwoRectRequest(root, 'create-two'))
      const before = await session.readFile('@/studio/View1.tao')
      const request = {
        checkpointId: 'snap-first',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['café'],
        requestId: 'snap-first-request',
        sketchId: 'sketch-1',
        sourceVersion: before.sourceVersion,
      }

      const proposal = await session.proposeSketchSnap(request)
      Expect(proposal.projectedRectIds).toEqual(['café'])
      Expect(proposal.tree).toMatchObject({ type: 'container' })
      Expect(proposal.diff).toContain('#studio_rect_00630061006600e9')
      Expect(proposal.content).toContain('#studio_rect_00630061006600e9')

      const result = await session.applySketchSnap(request)
      Expect(result.file.content).toBe(proposal.content)
      const sketch = result.catalog.sketches[0]!
      Expect(sketch.rects.map(rect => rect.id)).toEqual(['subtitle'])
      Expect(sketch.snapped).toHaveLength(1)
      Expect(sketch.snapped[0]).toMatchObject({
        rect: { id: 'café', kind: 'Avatar' },
        target: {
          elementName: 'Placeholder',
          path: '@/studio/View1.tao',
          sourceVersion: result.file.sourceVersion,
          studioRectId: 'café',
          view: 'View1',
        },
      })
      Expect(sketch.snapped[0]?.target.renderId).toContain(`${FS.resolvePath('@/studio/View1.tao', root)}:`)
      Expect(result.file.content).toContain('#studio_rect_00630061006600e9')
      Expect(await FS.fileMode(FS.resolvePath('@/studio/View1.tao', root))).toBe(0o444)
      Expect(compiles).toHaveLength(2)
    })
  })

  Test('prepends a later partial Snap according to geometry while retaining authored children', async () => {
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction(createHorizontalThreeRectRequest(root, 'create-before'))
      const initial = await session.readFile('@/studio/View1.tao')
      const first = await session.applySketchSnap({
        checkpointId: 'snap-before-existing',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['middle', 'right'],
        requestId: 'snap-before-existing-request',
        sketchId: 'sketch-1',
        sourceVersion: initial.sourceVersion,
      })
      const path = FS.resolvePath('@/studio/View1.tao', root)
      const generated = new StudioGeneratedSources(root)
      await generated.rewrite(path, first.file.content.replace('Text("Middle")', 'Text("Edited middle")'))
      const edited = await session.readFile('@/studio/View1.tao')
      const second = await session.applySketchSnap({
        checkpointId: 'snap-before-new',
        expectedCatalogRevision: first.catalog.revision,
        rectIds: ['left'],
        requestId: 'snap-before-new-request',
        sketchId: 'sketch-1',
        sourceVersion: edited.sourceVersion,
      })

      Expect(second.file.content).toContain('Text("Edited middle")')
      Expect(second.file.content.indexOf('#studio_rect_006c006500660074')).toBeLessThan(
        second.file.content.indexOf('#studio_rect_006d006900640064006c0065'),
      )
      Expect(second.file.content.indexOf('#studio_rect_006d006900640064006c0065')).toBeLessThan(
        second.file.content.indexOf('#studio_rect_00720069006700680074'),
      )
    })
  })

  Test('wraps the authored Snap subtree when later geometry changes the root axis', async () => {
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction(createAxisChangeRequest(root, 'create-axis-change'))
      const initial = await session.readFile('@/studio/View1.tao')
      const first = await session.applySketchSnap({
        checkpointId: 'snap-axis-existing',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['top', 'bottom'],
        requestId: 'snap-axis-existing-request',
        sketchId: 'sketch-1',
        sourceVersion: initial.sourceVersion,
      })
      const path = FS.resolvePath('@/studio/View1.tao', root)
      const generated = new StudioGeneratedSources(root)
      await generated.rewrite(path, first.file.content.replace('Text("Top")', 'Text("Edited top")'))
      const edited = await session.readFile('@/studio/View1.tao')
      const second = await session.applySketchSnap({
        checkpointId: 'snap-axis-new',
        expectedCatalogRevision: first.catalog.revision,
        rectIds: ['right'],
        requestId: 'snap-axis-new-request',
        sketchId: 'sketch-1',
        sourceVersion: edited.sourceVersion,
      })

      Expect(second.file.content).toContain('render Row()')
      Expect(second.file.content).toContain('Col()')
      Expect(second.file.content).toContain('Text("Edited top")')
      Expect(second.file.content.indexOf('#studio_rect_0074006f0070')).toBeLessThan(
        second.file.content.indexOf('#studio_rect_00720069006700680074'),
      )
    })
  })

  Test('rejects interleaved partial Snap geometry before source, catalog, or compile mutation', async () => {
    await withSketchSession(async (session, root, compiles) => {
      const created = await session.applySketchAction(createHorizontalThreeRectRequest(root, 'create-interleaved'))
      const initial = await session.readFile('@/studio/View1.tao')
      const first = await session.applySketchSnap({
        checkpointId: 'snap-interleaved-edges',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['left', 'right'],
        requestId: 'snap-interleaved-edges-request',
        sketchId: 'sketch-1',
        sourceVersion: initial.sourceVersion,
      })
      const beforeFile = await session.readFile('@/studio/View1.tao')
      const beforeCatalog = await session.sketchCatalog()
      const beforeCompileCount = compiles.length

      await Expect(session.applySketchSnap({
        checkpointId: 'snap-interleaved-middle',
        expectedCatalogRevision: first.catalog.revision,
        rectIds: ['middle'],
        requestId: 'snap-interleaved-middle-request',
        sketchId: 'sketch-1',
        sourceVersion: beforeFile.sourceVersion,
      })).rejects.toThrow('cannot preserve authored source for interleaved rectangle geometry')

      Expect(await session.readFile('@/studio/View1.tao')).toEqual(beforeFile)
      Expect(await session.sketchCatalog()).toEqual(beforeCatalog)
      Expect(compiles).toHaveLength(beforeCompileCount)
    })
  })

  Test('preserves manual and flow edits across partial Snap and Unsnap, including the last leaf', async () => {
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction(createTwoRectRequest(root, 'create-preserving'))
      const initial = await session.readFile('@/studio/View1.tao')
      const first = await session.applySketchSnap({
        checkpointId: 'snap-preserving-first',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['café'],
        requestId: 'snap-preserving-first-request',
        sketchId: 'sketch-1',
        sourceVersion: initial.sourceVersion,
      })
      const path = FS.resolvePath('@/studio/View1.tao', root)
      const generated = new StudioGeneratedSources(root)
      await generated.rewrite(path, first.file.content.replace('width 52', 'width 61'))
      const manuallyEdited = await session.readFile('@/studio/View1.tao')
      const second = await session.applySketchSnap({
        checkpointId: 'snap-preserving-second',
        expectedCatalogRevision: first.catalog.revision,
        rectIds: ['subtitle'],
        requestId: 'snap-preserving-second-request',
        sketchId: 'sketch-1',
        sourceVersion: manuallyEdited.sourceVersion,
      })

      Expect(second.file.content).toContain('Placeholder("Profile") [width 61, height 52]')
      Expect(second.catalog.sketches[0]!.snapped).toHaveLength(2)
      Expect(second.catalog.sketches[0]!.snapped.every(item => item.target.sourceVersion === second.file.sourceVersion))
        .toBe(true)

      const flowed = await session.applySketchFlowAction({
        action: { kind: 'toggle-direction', rectId: 'café' },
        checkpointId: 'flow-preserving',
        expectedCatalogRevision: second.catalog.revision,
        requestId: 'flow-preserving-request',
        sketchId: 'sketch-1',
        sourceVersion: second.file.sourceVersion,
      })
      const partial = await session.applySketchUnsnap({
        checkpointId: 'unsnap-preserving-partial',
        expectedCatalogRevision: flowed.catalog.revision,
        rectIds: ['subtitle'],
        requestId: 'unsnap-preserving-partial-request',
        sketchId: 'sketch-1',
        sourceVersion: flowed.file.sourceVersion,
      })
      Expect(partial.file.content).toContain('Placeholder("Profile") [width 61, height 52]')
      Expect(partial.file.content).toContain('Row() [pad top 12 right 296 bottom 12 left 12]')
      Expect(partial.catalog.sketches[0]!.snapped[0]!.target.sourceVersion).toBe(partial.file.sourceVersion)

      await generated.rewrite(
        path,
        partial.file.content
          .replace('view View1() {', 'view View1(Name text) {\n   state Edited = true')
          .replace('render ()', 'render (Name: "Ada")'),
      )
      const enriched = await session.readFile('@/studio/View1.tao')
      const last = await session.applySketchUnsnap({
        checkpointId: 'unsnap-preserving-last',
        expectedCatalogRevision: partial.catalog.revision,
        rectIds: ['café'],
        requestId: 'unsnap-preserving-last-request',
        sketchId: 'sketch-1',
        sourceVersion: enriched.sourceVersion,
      })
      Expect(last.file.content).toContain('view View1(Name text)')
      Expect(last.file.content).toContain('state Edited = true')
      Expect(last.file.content).toContain('render (Name: "Ada")')
      Expect(last.file.content).toContain('render Placeholder("View1") [width 360, height 76]')
    })
  })

  Test('rebuilds partial Snap, supports arbitrary Unsnap, and keeps undo revisions monotonic', async () => {
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction(createTwoRectRequest(root, 'create-two'))
      const initial = await session.readFile('@/studio/View1.tao')
      const first = await session.applySketchSnap({
        checkpointId: 'snap-first',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['café'],
        requestId: 'snap-first-request',
        sketchId: 'sketch-1',
        sourceVersion: initial.sourceVersion,
      })
      const second = await session.applySketchSnap({
        checkpointId: 'snap-second',
        expectedCatalogRevision: first.catalog.revision,
        rectIds: ['subtitle'],
        requestId: 'snap-second-request',
        sketchId: 'sketch-1',
        sourceVersion: first.file.sourceVersion,
      })
      Expect(second.catalog.sketches[0]?.snapped.map(item => item.rect.id)).toEqual(['café', 'subtitle'])
      Expect(second.file.content).toContain('#studio_rect_00630061006600e9')
      Expect(second.file.content).toContain('#studio_rect_007300750062007400690074006c0065')

      const undone = await session.undoSketchSnap({
        checkpointId: 'snap-second',
        expectedCatalogRevision: second.catalog.revision,
        requestId: 'undo-second',
        sourceVersion: second.file.sourceVersion,
      })
      Expect(undone.catalog.revision).toBe(second.catalog.revision + 1)
      Expect(undone.catalog.sketches[0]?.snapped.map(item => item.rect.id)).toEqual(['café'])
      Expect(undone.catalog.sketches[0]?.rects.map(rect => rect.id)).toEqual(['subtitle'])
      Expect(undone.file.content).toBe(first.file.content)
      await Expect(session.applySketchAction({
        action: { kind: 'delete-rect', rectId: 'subtitle', sketchId: 'sketch-1' },
        expectedRevision: first.catalog.revision,
        requestId: 'stale-after-undo',
      })).rejects.toBeInstanceOf(StudioSketchCatalogConflictError)

      const unsnapped = await session.applySketchUnsnap({
        checkpointId: 'unsnap-first',
        expectedCatalogRevision: undone.catalog.revision,
        rectIds: ['café'],
        requestId: 'unsnap-first-request',
        sketchId: 'sketch-1',
        sourceVersion: undone.file.sourceVersion,
      })
      Expect(unsnapped.catalog.sketches[0]?.snapped).toEqual([])
      Expect(unsnapped.catalog.sketches[0]?.rects.map(rect => rect.id)).toEqual(['café', 'subtitle'])
      Expect(unsnapped.file.content).toContain('render Placeholder("View1") [width 360, height 76]')
      Expect(unsnapped.file.content).not.toContain('#studio_rect_')

      const undoUnsnap = await session.undoSketchSnap({
        checkpointId: 'unsnap-first',
        expectedCatalogRevision: unsnapped.catalog.revision,
        requestId: 'undo-unsnap-first',
        sourceVersion: unsnapped.file.sourceVersion,
      })
      Expect(undoUnsnap.catalog.revision).toBe(unsnapped.catalog.revision + 1)
      Expect(undoUnsnap.catalog.sketches[0]?.snapped.map(item => item.rect.id)).toEqual(['café'])
      Expect(undoUnsnap.file.content).toBe(undone.file.content)
    })
  })

  Test(
    'commits rect-authenticated flow edits, refreshes every target, rejects stale gaps, and undoes both stores',
    async () => {
      await withSketchSession(async (session, root) => {
        const created = await session.applySketchAction(createTwoRectRequest(root, 'create-flow'))
        const initial = await session.readFile('@/studio/View1.tao')
        const snapped = await session.applySketchSnap({
          checkpointId: 'snap-flow',
          expectedCatalogRevision: created.catalog.revision,
          rectIds: ['café', 'subtitle'],
          requestId: 'snap-flow-request',
          sketchId: 'sketch-1',
          sourceVersion: initial.sourceVersion,
        })
        const beforeTargets = snapped.catalog.sketches[0]!.snapped.map(item => item.target)
        const flowed = await session.applySketchFlowAction({
          action: { afterRectId: 'café', beforeRectId: 'subtitle', kind: 'insert-separator' },
          checkpointId: 'flow-separator',
          expectedCatalogRevision: snapped.catalog.revision,
          requestId: 'flow-separator-request',
          sketchId: 'sketch-1',
          sourceVersion: snapped.file.sourceVersion,
        })

        Expect(flowed.file.content).toContain('Box() [width 1, height fill]')
        Expect(flowed.catalog.revision).toBe(snapped.catalog.revision + 1)
        const refreshed = flowed.catalog.sketches[0]!.snapped.map(item => item.target)
        Expect(refreshed.every(target => target.sourceVersion === flowed.file.sourceVersion)).toBe(true)
        Expect(refreshed[1]?.renderId).not.toBe(beforeTargets[1]?.renderId)
        await Expect(session.applySketchFlowAction({
          action: { afterRectId: 'café', beforeRectId: 'subtitle', kind: 'insert-spacer', ratio: [2, 3] },
          checkpointId: 'flow-nonadjacent',
          expectedCatalogRevision: flowed.catalog.revision,
          requestId: 'flow-nonadjacent-request',
          sketchId: 'sketch-1',
          sourceVersion: flowed.file.sourceVersion,
        })).rejects.toThrow('adjacent render expressions')
        await Expect(session.applySketchFlowAction({
          action: { kind: 'toggle-direction', rectId: 'deleted-rect' },
          checkpointId: 'flow-stale-id',
          expectedCatalogRevision: flowed.catalog.revision,
          requestId: 'flow-stale-id-request',
          sketchId: 'sketch-1',
          sourceVersion: flowed.file.sourceVersion,
        })).rejects.toThrow('snapped rectangle does not exist')

        const undone = await session.undoSketchSnap({
          checkpointId: 'flow-separator',
          expectedCatalogRevision: flowed.catalog.revision,
          requestId: 'undo-flow-separator',
          sourceVersion: flowed.file.sourceVersion,
        })
        Expect(undone.file.content).toBe(snapped.file.content)
        Expect(undone.catalog.revision).toBe(flowed.catalog.revision + 1)
        Expect(undone.catalog.sketches[0]!.snapped.map(item => item.target)).toEqual(beforeTargets)
      })
    },
  )

  Test('rolls generated source and catalog back when a flow edit fails compilation', async () => {
    let failCompile = false
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction(createTwoRectRequest(root, 'create-flow-rollback'))
      const initial = await session.readFile('@/studio/View1.tao')
      const snapped = await session.applySketchSnap({
        checkpointId: 'snap-flow-rollback',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['café', 'subtitle'],
        requestId: 'snap-flow-rollback-request',
        sketchId: 'sketch-1',
        sourceVersion: initial.sourceVersion,
      })
      const beforeCatalog = await session.sketchCatalog()
      failCompile = true
      await Expect(session.applySketchFlowAction({
        action: { kind: 'toggle-direction', rectId: 'café' },
        checkpointId: 'flow-failing-compile',
        expectedCatalogRevision: snapped.catalog.revision,
        requestId: 'flow-failing-compile-request',
        sketchId: 'sketch-1',
        sourceVersion: snapped.file.sourceVersion,
      })).rejects.toThrow('generated Tao source failed to compile')
      Expect(await session.readFile('@/studio/View1.tao')).toEqual(snapped.file)
      Expect(await session.sketchCatalog()).toEqual(beforeCatalog)
      Expect(await FS.fileMode(FS.resolvePath('@/studio/View1.tao', root))).toBe(0o444)
    }, () => {
      if (failCompile) {
        failCompile = false
        Errors.throwUserInput('Flow preview is invalid.')
      }
    })
  })

  Test('drops retyped reopen associations and uses current measured geometry for later arbitrary Unsnap', async () => {
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction(createRequest(root, 'create-measured'))
      const initial = await session.readFile('@/studio/View1.tao')
      const snapped = await session.applySketchSnap({
        checkpointId: 'snap-measured',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['cover'],
        requestId: 'snap-measured-request',
        sketchId: 'sketch-1',
        sourceVersion: initial.sourceVersion,
      })
      const renderId = snapped.catalog.sketches[0]!.snapped[0]!.target.renderId
      const cell = {
        args: {},
        cellId: 'cell:measured',
        cellRevision: 0,
        environment: {
          network: { latencyMs: 0, outcome: 'normal' as const },
          scheme: {
            capability: 'reactive-browser' as const,
            requested: 'system' as const,
            resolved: 'light' as const,
            source: 'system' as const,
          },
          viewport: { height: 76, presetId: 'sketch', width: 360 },
        },
        scenarioId: 'Garden.measured',
        stateLayers: [],
      }
      const generatedPath = FS.resolvePath('@/studio/View1.tao', root)
      const manifest = {
        capabilities: { captureDomains: [], scheme: 'reactive-browser' as const },
        cells: [cell],
        compileRevision: session.compileSnapshot().compileRevision,
        fixtures: [],
        generationDeclarations: [],
        manifestRevision: 'manifest-measured',
        parametersBySubject: { 'app:Garden': [] },
        project: { appName: session.appName, entryPath: 'Garden.tao', root },
        renders: [{
          elementName: 'Text',
          renderId,
          source: { kind: 'tao' as const, path: generatedPath, range: { end: 2, start: 1 } },
          studioRectId: 'cover',
        }],
        scenarios: [{
          args: {},
          group: 'Garden',
          label: 'Measured',
          prepare: [],
          scenarioId: 'Garden.measured',
          source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: 1, start: 0 } },
          stateLayers: [],
          subjectId: 'app:Garden',
        }],
        sourceVersions: { [generatedPath]: snapped.file.sourceVersion },
        states: [],
        subjects: [{
          appName: 'Garden',
          kind: 'app' as const,
          source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: 1, start: 0 } },
          subjectId: 'app:Garden',
        }],
        version: 2 as const,
      }
      session.setMatrixManifest(manifest)
      const generated = new StudioGeneratedSources(root)
      await generated.rewrite(generatedPath, `${snapped.file.content}\n`)
      const retainedAgainstStaleManifest = await session.sketchCatalog()
      Expect(retainedAgainstStaleManifest.revision).toBe(snapped.catalog.revision)
      Expect(retainedAgainstStaleManifest.sketches[0]!.snapped.map(item => item.rect.id)).toEqual(['cover'])
      await generated.rewrite(generatedPath, snapped.file.content)
      const identity = StudioPreviewManifest.cellIdentity(manifest, cell)
      session.registerCellPreview({ ...identity, previewInstanceId: 'preview-measured' })
      session.recordPreviewLayoutMeasurements({
        channel: studioProtocolChannel,
        identity: { ...identity, previewInstanceId: 'preview-measured' },
        measurements: [{
          elementName: 'Text',
          rect: { height: 20, width: 90, x: 300, y: 70 },
          renderId,
          studioRectId: 'cover',
        }],
        protocolVersion: studioProtocolVersion,
        type: 'preview-layout-measurements',
      })

      const reconciled = await session.sketchCatalog()
      Expect(reconciled.revision).toBe(snapped.catalog.revision + 1)
      Expect(reconciled.sketches[0]).toMatchObject({ rectOrder: [], rects: [], snapped: [] })
      const unsnapped = await session.applySketchUnsnap({
        checkpointId: 'unsnap-measured',
        expectedCatalogRevision: reconciled.revision,
        rectIds: ['cover'],
        requestId: 'unsnap-measured-request',
        sketchId: 'sketch-1',
        sourceVersion: snapped.file.sourceVersion,
      })
      Expect(unsnapped.catalog.sketches[0]!.rects).toEqual([{
        height: 20,
        id: 'cover',
        kind: 'Text',
        width: 90,
        x: 270,
        y: 56,
      }])
    })
  })

  Test('requires the canonical proposal version for overlapping Snap without publishing early success', async () => {
    await withSketchSession(async (session, root) => {
      const created = await session.applySketchAction({
        action: {
          height: 76,
          id: 'sketch-1',
          kind: 'create-sketch',
          project: root,
          rects: [
            { height: 40, id: 'one', kind: 'Placeholder', width: 80, x: 10, y: 10 },
            { height: 40, id: 'two', kind: 'Placeholder', width: 80, x: 30, y: 30 },
          ],
          width: 360,
        },
        expectedRevision: 0,
        requestId: 'create-overlap',
      })
      const before = await session.readFile('@/studio/View1.tao')
      const events: StudioSessionEvent[] = []
      session.subscribe(event => events.push(event))
      const request = {
        checkpointId: 'snap-overlap',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['one', 'two'],
        requestId: 'snap-overlap-request',
        sketchId: 'sketch-1',
        sourceVersion: before.sourceVersion,
      }
      const proposal = await session.proposeSketchSnap(request)
      Expect(proposal.needsConfirmation).toBe(true)
      await Expect(session.applySketchSnap(request)).rejects.toThrow('requires confirmation')
      Expect(await session.readFile('@/studio/View1.tao')).toEqual(before)
      Expect((await session.sketchCatalog()).revision).toBe(created.catalog.revision)
      Expect(events.some(event => event.type === 'file-changed' || event.type === 'sketch-catalog-changed')).toBe(false)

      const applied = await session.applySketchSnap({
        ...request,
        confirmedProposalVersion: proposal.proposedSourceVersion,
      })
      Expect(applied.catalog.sketches[0]?.snapped).toHaveLength(2)
    })
  })

  Test('restores generated source and leaves catalog unchanged when Snap compilation fails', async () => {
    let failCompile = false
    await withSketchSession(async (session, root, compiles) => {
      const created = await session.applySketchAction(createTwoRectRequest(root, 'create-two'))
      const beforeFile = await session.readFile('@/studio/View1.tao')
      const beforeCatalog = await session.sketchCatalog()
      const events: StudioSessionEvent[] = []
      session.subscribe(event => events.push(event))
      failCompile = true

      await Expect(session.applySketchSnap({
        checkpointId: 'snap-failing-compile',
        expectedCatalogRevision: created.catalog.revision,
        rectIds: ['café'],
        requestId: 'snap-failing-compile-request',
        sketchId: 'sketch-1',
        sourceVersion: beforeFile.sourceVersion,
      })).rejects.toThrow('generated Tao source failed to compile')

      Expect(await session.readFile('@/studio/View1.tao')).toEqual(beforeFile)
      Expect(await session.sketchCatalog()).toEqual(beforeCatalog)
      Expect(compiles).toHaveLength(3)
      Expect(events.some(event => event.type === 'file-changed' || event.type === 'sketch-catalog-changed')).toBe(false)
      Expect(await FS.fileMode(FS.resolvePath('@/studio/View1.tao', root))).toBe(0o444)
    }, () => {
      if (failCompile) {
        failCompile = false
        Errors.throwUserInput('Snap preview is invalid.')
      }
    })
  })

  Test('restores generated source when the catalog commit fails after a successful Snap compile', async () => {
    let failCatalog = false
    const sketchCatalogIO: StudioSketchCatalogIO = {
      async move(temporaryPath, catalogPath) {
        if (failCatalog) {
          failCatalog = false
          Errors.throwHostEnvironment('simulated Snap catalog commit failure')
        }
        await FS.move(temporaryPath, catalogPath)
      },
    }
    await withSketchSession(
      async (session, root, compiles) => {
        const created = await session.applySketchAction(createTwoRectRequest(root, 'create-two'))
        const beforeFile = await session.readFile('@/studio/View1.tao')
        const beforeCatalog = await session.sketchCatalog()
        const events: StudioSessionEvent[] = []
        session.subscribe(event => events.push(event))
        failCatalog = true

        await Expect(session.applySketchSnap({
          checkpointId: 'snap-failing-catalog',
          expectedCatalogRevision: created.catalog.revision,
          rectIds: ['café'],
          requestId: 'snap-failing-catalog-request',
          sketchId: 'sketch-1',
          sourceVersion: beforeFile.sourceVersion,
        })).rejects.toThrow('simulated Snap catalog commit failure')

        Expect(await session.readFile('@/studio/View1.tao')).toEqual(beforeFile)
        Expect(await session.sketchCatalog()).toEqual(beforeCatalog)
        Expect(compiles).toHaveLength(3)
        Expect(events.some(event => event.type === 'file-changed' || event.type === 'sketch-catalog-changed')).toBe(
          false,
        )
      },
      () => {},
      { sketchCatalogIO },
    )
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
          Errors.throwUserInput('Generated preview is invalid.')
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

  Test('routes typed Snap, flow, undo, and arbitrary Unsnap requests', async () => {
    const calls: Array<{ body: unknown; operation: string }> = []
    const session = {
      async applySketchSnap(body: unknown) {
        calls.push({ body, operation: 'apply' })
        return { operation: 'applied' }
      },
      async applySketchFlowAction(body: unknown) {
        calls.push({ body, operation: 'flow' })
        return { operation: 'flowed' }
      },
      async applySketchUnsnap(body: unknown) {
        calls.push({ body, operation: 'unsnap' })
        return { operation: 'unsnapped' }
      },
      recordPreviewLayoutMeasurements(body: unknown) {
        calls.push({ body, operation: 'measurements' })
        return { accepted: true }
      },
      async proposeSketchSnap(body: unknown) {
        calls.push({ body, operation: 'propose' })
        return { operation: 'proposed' }
      },
      subscribe: () => () => {},
      async undoSketchSnap(body: unknown) {
        calls.push({ body, operation: 'undo' })
        return { operation: 'undone' }
      },
    } as unknown as StudioProjectSession
    const body = { requestId: 'snap-route' }
    const routes = [
      ['/api/sketches/snap/propose', 'proposed'],
      ['/api/sketches/snap/apply', 'applied'],
      ['/api/sketches/flow/action', 'flowed'],
      ['/api/sketches/snap/undo', 'undone'],
      ['/api/sketches/unsnap/apply', 'unsnapped'],
      ['/api/preview/layout-measurements', undefined],
    ] as const

    for (const [path, operation] of routes) {
      const url = new URL(`http://127.0.0.1:5678${path}`)
      const response = await StudioServerTesting.handleRequest(
        session,
        {} as StudioFixtureGeneration,
        new Request(url, {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
        url,
        {},
      )
      Expect(await response.json()).toEqual(operation === undefined ? { accepted: true } : { operation })
    }
    Expect(calls.map(call => call.operation)).toEqual(['propose', 'apply', 'flow', 'undo', 'unsnap', 'measurements'])
    Expect(calls.every(call => JSON.stringify(call.body) === JSON.stringify(body))).toBe(true)
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

function createTwoRectRequest(project: string, requestId: string): StudioSketchCatalogRequest {
  return {
    action: {
      height: 76,
      id: 'sketch-1',
      kind: 'create-sketch',
      project,
      rects: [
        { content: 'Profile', height: 52, id: 'café', kind: 'Avatar', width: 52, x: 12, y: 12 },
        { content: 'Subtitle', height: 20, id: 'subtitle', kind: 'Text', width: 120, x: 80, y: 20 },
      ],
      width: 360,
    },
    expectedRevision: 0,
    requestId,
  }
}

function createHorizontalThreeRectRequest(project: string, requestId: string): StudioSketchCatalogRequest {
  return {
    action: {
      height: 80,
      id: 'sketch-1',
      kind: 'create-sketch',
      project,
      rects: [
        { content: 'Left', height: 20, id: 'left', kind: 'Text', width: 40, x: 10, y: 20 },
        { content: 'Middle', height: 20, id: 'middle', kind: 'Text', width: 50, x: 80, y: 20 },
        { content: 'Right', height: 20, id: 'right', kind: 'Text', width: 40, x: 160, y: 20 },
      ],
      width: 240,
    },
    expectedRevision: 0,
    requestId,
  }
}

function createAxisChangeRequest(project: string, requestId: string): StudioSketchCatalogRequest {
  return {
    action: {
      height: 120,
      id: 'sketch-1',
      kind: 'create-sketch',
      project,
      rects: [
        { content: 'Top', height: 20, id: 'top', kind: 'Text', width: 50, x: 10, y: 10 },
        { content: 'Bottom', height: 20, id: 'bottom', kind: 'Text', width: 50, x: 10, y: 80 },
        { content: 'Right', height: 100, id: 'right', kind: 'Text', width: 60, x: 120, y: 10 },
      ],
      width: 220,
    },
    expectedRevision: 0,
    requestId,
  }
}

async function withSketchSession(
  use: (session: StudioProjectSession, root: string, compiles: unknown[]) => Promise<void>,
  compile: () => void = () => {},
  options: Readonly<{ sketchCatalogIO?: StudioSketchCatalogIO }> = {},
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
      ...options,
    })
    await use(session, await FS.realPath(root), compiles)
  })
}
