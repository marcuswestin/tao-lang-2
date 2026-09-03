import { Expect, Test } from '@shared/test'
import {
  applySketchSnapWith,
  StudioSketchMutationLane,
  type StudioSketchSnapApi,
  StudioSketchSnapRequests,
} from '../studio-src/client/StudioMatrixView'
import { StudioSketchGeometry } from '../studio-src/client/StudioSketchGeometry'
import {
  StudioSketchChanges,
  StudioSketchFlowControls,
  StudioSketchOuterDrawing,
  StudioSketchProposal,
  StudioSketchSelection,
} from '../studio-src/client/StudioSketchView'
import type {
  StudioSketchSnapApplyResult,
  StudioSketchSnapProposalResult,
  StudioSketchSnapUndoResult,
} from '../studio-src/StudioProjectSession'
import type { StudioSketch, StudioSketchRect } from '../studio-src/StudioSketchCatalog'

Test('Studio outer sketch drawing normalizes 360x76 and ignores taps, cancellation, and stray pointers', () => {
  const gesture = StudioSketchOuterDrawing.begin(undefined, 1, { x: 420, y: 100 })
  Expect(StudioSketchOuterDrawing.end(gesture, 2, { x: 60, y: 24 })).toEqual({ gesture })
  Expect(StudioSketchOuterDrawing.end(gesture, 1, { x: 60.4, y: 23.6 })).toEqual({
    size: { height: 76, width: 360 },
  })

  const tap = StudioSketchOuterDrawing.begin(undefined, 3, { x: 10, y: 10 })
  Expect(StudioSketchOuterDrawing.end(tap, 3, { x: 11, y: 11 })).toEqual({})
  Expect(StudioSketchOuterDrawing.cancel(tap, 4)).toBe(tap)
  Expect(StudioSketchOuterDrawing.cancel(tap, 3)).toBeUndefined()
})

Test('Studio overlay geometry preserves order across draw, move, duplicate, resize, and cancel', () => {
  const original = testRects()
  let state = StudioSketchGeometry.initial(original)
  state = StudioSketchGeometry.beginDraw(state, 'drawn', { x: 250, y: 10 })
  state = StudioSketchGeometry.endPointer(state, { x: 300, y: 50 })
  Expect(state.rects.map(rect => rect.id)).toEqual(['back', 'front', 'drawn'])

  state = StudioSketchGeometry.beginMove(state, { x: 260, y: 20 })
  state = StudioSketchGeometry.endPointer(state, { x: 270, y: 25 })
  Expect(state.rects.at(-1)).toMatchObject({ height: 40, width: 50, x: 260, y: 15 })

  state = StudioSketchGeometry.beginMove(state, { x: 270, y: 25 }, { duplicateId: 'copy', optionKey: true })
  state = StudioSketchGeometry.endPointer(state, { x: 280, y: 30 })
  Expect(state.rects.map(rect => rect.id)).toEqual(['back', 'front', 'drawn', 'copy'])

  state = StudioSketchGeometry.beginResize(state, 'east', { x: 320, y: 30 })
  state = StudioSketchGeometry.endPointer(state, { x: 340, y: 30 })
  Expect(state.rects.at(-1)?.width).toBe(70)

  state = StudioSketchGeometry.beginDraw(state, 'cancelled', { x: 5, y: 5 })
  state = StudioSketchGeometry.updatePointer(state, { x: 40, y: 40 })
  state = StudioSketchGeometry.cancelPointer(state)
  Expect(state.rects.some(rect => rect.id === 'cancelled')).toBe(false)
})

Test('Studio sketch changes prefer authoritative duplicate order and serialize revision reads', async () => {
  const sketch = {
    height: 76,
    id: 'sketch-1',
    name: 'View1',
    project: 'music',
    rectOrder: ['back', 'front'],
    rects: testRects(),
    snapped: [],
    view: 'View1',
    width: 360,
  }
  const copy = { ...sketch.rects[0]!, id: 'copy' }
  Expect(StudioSketchChanges.equal(sketch.rects[0]!, { ...sketch.rects[0]! })).toBe(true)
  Expect(StudioSketchChanges.equal(sketch.rects[0]!, { ...sketch.rects[0]!, x: 11 })).toBe(false)
  const authoritative = [{
    ...sketch,
    rectOrder: ['back', 'copy', 'front'],
    rects: [sketch.rects[0]!, copy, sketch.rects[1]!],
  }]
  Expect(
    StudioSketchChanges.settle([sketch], {
      kind: 'duplicate',
      rect: copy,
      sketchId: sketch.id,
      sourceRectId: sketch.rects[0]!.id,
    }, authoritative)[0]?.rects.map(rect => rect.id),
  ).toEqual(['back', 'copy', 'front'])

  const lane = new StudioSketchMutationLane()
  const revisions: number[] = []
  let revision = 0
  let releaseFirst: (() => void) | undefined
  const first = lane.run(async () => {
    revisions.push(revision)
    await new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    revision = 1
  })
  const second = lane.run(async () => {
    revisions.push(revision)
    revision = 2
  })
  await Promise.resolve()
  Expect(revisions).toEqual([0])
  releaseFirst!()
  await Promise.all([first, second])
  Expect(revisions).toEqual([0, 1])
})

Test('Studio Snap selection chooses explicit free rectangles or all free rectangles and settles partial Snap', () => {
  const sketch = testSketch()
  let selected = StudioSketchSelection.toggle(new Set(), 'back', false)
  selected = StudioSketchSelection.toggle(selected, 'front', true)
  Expect(StudioSketchSelection.rectIds(sketch, selected)).toEqual(['back', 'front'])
  selected = StudioSketchSelection.toggle(selected, 'back', true)
  Expect(StudioSketchSelection.rectIds(sketch, selected)).toEqual(['front'])
  Expect(StudioSketchSelection.rectIds(sketch, new Set())).toEqual(['back', 'front'])

  const partial = {
    ...sketch,
    rects: [sketch.rects[0]!],
    snapped: [{ rect: sketch.rects[1]!, target: target('front') }],
  }
  Expect([...StudioSketchSelection.settle(partial, new Set(['back', 'front']))]).toEqual(['back'])
})

Test('Studio flow controls expose explicit selection reasons and bounded spacer mutations', () => {
  Expect(StudioSketchFlowControls.availability(0, true, true)).toEqual({
    direction: { disabled: true, reason: 'Select at least one snapped rectangle.' },
    separator: { disabled: true, reason: 'Select at least one snapped rectangle.' },
    spacer: { disabled: true, reason: 'Select exactly two snapped rectangles.' },
  })
  Expect(StudioSketchFlowControls.availability(1, true, true)).toMatchObject({
    direction: { disabled: false },
    separator: { disabled: false },
    spacer: { disabled: true, reason: 'Select exactly two snapped rectangles.' },
  })
  Expect(StudioSketchFlowControls.availability(2, true, true)).toMatchObject({
    direction: { disabled: false },
    separator: { disabled: false },
    spacer: { disabled: false },
  })
  Expect(StudioSketchFlowControls.availability(2, false, true).spacer).toEqual({
    disabled: true,
    reason: 'Flow action endpoint is unavailable.',
  })
  Expect(StudioSketchFlowControls.spacerAction(['back', 'front'], 35)).toEqual({
    afterRectId: 'back',
    beforeRectId: 'front',
    kind: 'insert-spacer',
    ratio: [35, 65],
  })
  Expect(StudioSketchFlowControls.spacerAction(['back'], 35)).toBeUndefined()
  Expect(StudioSketchFlowControls.spacerAction(['back', 'front'], 100)).toBeUndefined()
})

Test('Studio overlap proposal exposes exact confirmation and Cancel performs no mutation', () => {
  const proposal = {
    diff: '--- View1.tao\n+++ View1.tao (proposed)',
    needsConfirmation: true,
    path: '.tao-project/studio/View1.tao',
    projectedRectIds: ['front'],
    proposedSourceVersion: 'proposed-2',
    requestId: 'proposal-1',
    sourceVersion: 'source-1',
    tree: { arguments: ['Front'], component: 'Text', layout: [['hug']], rectId: 'front', type: 'element' },
  } as const
  Expect(StudioSketchProposal.confirmation(proposal)).toEqual({
    confirmedProposalVersion: 'proposed-2',
    rectIds: ['front'],
  })
  Expect(StudioSketchProposal.cancel()).toBeUndefined()
})

Test(
  'Studio Snap applies clean projection directly and keeps overlap catalog authoritative until confirmation',
  async () => {
    const initial = catalog(3, testSketch())
    const appliedCatalog = catalog(4, {
      ...testSketch(),
      rects: [testRects()[0]!],
      snapped: [{ rect: testRects()[1]!, target: target('front') }],
    })
    const calls: Array<{ revision: number; route: string }> = []
    let overlap = false
    const api: StudioSketchSnapApi = {
      async sketchSnapApply(request) {
        calls.push({ revision: request.expectedCatalogRevision, route: 'apply' })
        return snapApply(appliedCatalog, request.requestId, request.checkpointId)
      },
      async sketchSnapProposal(request) {
        calls.push({ revision: request.expectedCatalogRevision, route: 'proposal' })
        return snapProposal(request.requestId, overlap)
      },
      async sketchUnsnapApply(request) {
        return snapApply(initial, request.requestId, request.checkpointId)
      },
      async undoSketchSnap(request) {
        return snapUndo(initial, request.requestId, request.checkpointId)
      },
    }
    const state = { catalog: initial, mutationLane: new StudioSketchMutationLane() }
    const request = {
      checkpointId: 'snap-1',
      rectIds: ['front'],
      sketchId: 'sketch-1',
      sourceVersion: 'source-1',
    }
    const ids = ['proposal-clean', 'apply-clean', 'proposal-overlap', 'apply-overlap'][Symbol.iterator]()

    const clean = await applySketchSnapWith(state, request, api, () => ids.next().value!)
    Expect('catalog' in clean).toBe(true)
    Expect(state.catalog.revision).toBe(4)

    state.catalog = initial
    overlap = true
    const proposal = await applySketchSnapWith(state, request, api, () => ids.next().value!)
    Expect('diff' in proposal).toBe(true)
    Expect(state.catalog.revision).toBe(3)
    const confirmed = await applySketchSnapWith(
      state,
      {
        ...request,
        confirmedProposalVersion: 'proposed-2',
      },
      api,
      () => ids.next().value!,
    )
    Expect('catalog' in confirmed).toBe(true)
    Expect(state.catalog.revision).toBe(4)
    Expect(calls).toEqual([
      { revision: 3, route: 'proposal' },
      { revision: 3, route: 'apply' },
      { revision: 3, route: 'proposal' },
      { revision: 3, route: 'apply' },
    ])
  },
)

Test('Studio Snap, flow, Unsnap, and Undo requests read serialized authoritative revisions', async () => {
  const lane = new StudioSketchMutationLane()
  const requests: unknown[] = []
  let revision = 3
  let releaseFirst: (() => void) | undefined
  const first = lane.run(async () => {
    requests.push(StudioSketchSnapRequests.snap(
      {
        checkpointId: 'snap-1',
        rectIds: ['front'],
        sketchId: 'sketch-1',
        sourceVersion: 'source-1',
      },
      revision,
      'request-1',
    ))
    await new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    revision = 4
  })
  const second = lane.run(async () => {
    requests.push(StudioSketchSnapRequests.unsnap(
      {
        checkpointId: 'unsnap-1',
        rectIds: ['front'],
        sketchId: 'sketch-1',
        sourceVersion: 'source-2',
      },
      revision,
      'request-2',
    ))
    revision = 5
    requests.push(StudioSketchSnapRequests.flow(
      {
        action: { kind: 'toggle-direction', rectId: 'front' },
        checkpointId: 'flow-1',
        sketchId: 'sketch-1',
        sourceVersion: 'source-3',
      },
      revision,
      'request-flow',
    ))
    revision = 6
    requests.push(StudioSketchSnapRequests.undo(
      {
        checkpointId: 'unsnap-1',
        sourceVersion: 'source-4',
      },
      revision,
      'request-3',
    ))
  })
  await Promise.resolve()
  Expect(requests).toHaveLength(1)
  releaseFirst!()
  await Promise.all([first, second])
  Expect(requests).toEqual([
    {
      checkpointId: 'snap-1',
      expectedCatalogRevision: 3,
      rectIds: ['front'],
      requestId: 'request-1',
      sketchId: 'sketch-1',
      sourceVersion: 'source-1',
    },
    {
      checkpointId: 'unsnap-1',
      expectedCatalogRevision: 4,
      rectIds: ['front'],
      requestId: 'request-2',
      sketchId: 'sketch-1',
      sourceVersion: 'source-2',
    },
    {
      checkpointId: 'flow-1',
      expectedCatalogRevision: 5,
      action: { kind: 'toggle-direction', rectId: 'front' },
      requestId: 'request-flow',
      sketchId: 'sketch-1',
      sourceVersion: 'source-3',
    },
    {
      checkpointId: 'unsnap-1',
      expectedCatalogRevision: 6,
      requestId: 'request-3',
      sourceVersion: 'source-4',
    },
  ])
})

function testSketch(): StudioSketch {
  return {
    height: 76,
    id: 'sketch-1',
    name: 'View1',
    project: 'music',
    rectOrder: ['back', 'front'],
    rects: testRects(),
    snapped: [],
    view: 'View1',
    width: 360,
  }
}

function target(rectId: string) {
  return {
    elementName: 'Text',
    path: '.tao-project/studio/View1.tao',
    renderId: `View1:${rectId}`,
    sourceVersion: 'source-2',
    studioRectId: rectId,
    view: 'View1',
  }
}

function catalog(revision: number, sketch: ReturnType<typeof testSketch>) {
  return { formatVersion: 2 as const, nextViewNumber: 2, revision, sketches: [sketch] }
}

function snapProposal(requestId: string, needsConfirmation: boolean): StudioSketchSnapProposalResult {
  return {
    diff: 'canonical diff',
    needsConfirmation,
    path: '.tao-project/studio/View1.tao',
    projectedRectIds: ['front'],
    proposedSourceVersion: 'proposed-2',
    requestId,
    sourceVersion: 'source-1',
    tree: { arguments: ['Front'], component: 'Text', layout: [['hug']], rectId: 'front', type: 'element' },
  }
}

function snapApply(
  value: ReturnType<typeof catalog>,
  requestId: string,
  checkpointId: string,
): StudioSketchSnapApplyResult {
  return {
    catalog: value,
    checkpoint: { id: checkpointId, status: 'committed' },
    compile: {
      causes: ['studio-write'],
      changes: [],
      compileRevision: 2,
      diagnostics: [],
      message: 'ok',
      status: 'compiled',
    },
    file: {
      content: 'view View1',
      diagnosticCount: 0,
      dirty: false,
      kind: 'file',
      path: '.tao-project/studio/View1.tao',
      sourceVersion: 'source-2',
    },
    projectedRectIds: ['front'],
    requestId,
  }
}

function snapUndo(
  value: ReturnType<typeof catalog>,
  requestId: string,
  checkpointId: string,
): StudioSketchSnapUndoResult {
  const applied = snapApply(value, requestId, checkpointId)
  return { ...applied, checkpoint: { id: checkpointId, status: 'undone' } }
}

function testRects(): readonly StudioSketchRect[] {
  return [
    { height: 20, id: 'back', kind: 'Placeholder', width: 20, x: 10, y: 10 },
    { content: 'Front', height: 20, id: 'front', kind: 'Text', width: 20, x: 40, y: 10 },
  ]
}
