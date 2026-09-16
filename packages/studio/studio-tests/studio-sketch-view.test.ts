import { Assert } from '@shared'
import { Deferred, Expect, Test } from '@shared/test'
import {
  applySketchSnapWith,
  StudioSketchMutationLane,
  type StudioSketchSnapApi,
  StudioSketchSnapRequests,
} from '../studio-src/client/StudioMatrixView'
import { StudioSketchGeometry } from '../studio-src/client/StudioSketchGeometry'
import {
  StudioSketchBoardInput,
  StudioSketchChanges,
  StudioSketchDragOneIn,
  StudioSketchDragTarget,
  StudioSketchErrors,
  StudioSketchFlowControls,
  StudioSketchOuterDrawing,
  StudioSketchPointerRelease,
  StudioSketchProposal,
  StudioSketchRenderGate,
  StudioSketchSelection,
  StudioSketchView,
  StudioSketchViewNames,
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
    preview: { height: 76, width: 360, x: 60, y: 24 },
    size: { height: 76, width: 360, x: 60, y: 24 },
  })
  Expect(StudioSketchOuterDrawing.preview(gesture, { x: 60.4, y: 23.6 })).toEqual({
    height: 76,
    width: 360,
    x: 60,
    y: 24,
  })
  Expect(StudioSketchOuterDrawing.preview(gesture, { x: 421, y: 101 })).toBeUndefined()
  const clipped = StudioSketchOuterDrawing.end(
    StudioSketchOuterDrawing.begin(undefined, 8, { x: 20, y: 20 }),
    8,
    { x: -40, y: -30 },
  )
  Expect(clipped.size).toEqual({ height: 20, width: 20, x: 0, y: 0 })
  Expect(StudioSketchViewNames.next([])).toBe('View1')
  Expect(StudioSketchViewNames.next([{ view: 'View1' }, { view: 'View3' }])).toBe('View4')

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

Test('Studio sketch changes preserve optimistic and authoritative order and serialize revision reads', async () => {
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
    x: 24,
    y: 24,
  }
  const copy = { ...sketch.rects[0]!, id: 'copy' }
  Expect(StudioSketchChanges.equal(sketch.rects[0]!, { ...sketch.rects[0]! })).toBe(true)
  Expect(StudioSketchChanges.equal(sketch.rects[0]!, { ...sketch.rects[0]!, x: 11 })).toBe(false)
  const binding = {
    parameter: 'Playlist',
    path: 'Title',
    presentation: { kind: 'text' as const, label: { path: 'Owner.Name', prefix: 'By ', suffix: '!' } },
  }
  Expect(StudioSketchChanges.equal(
    { ...sketch.rects[0]!, fieldBinding: binding },
    {
      ...sketch.rects[0]!,
      fieldBinding: {
        ...binding,
        presentation: { ...binding.presentation, label: { ...binding.presentation.label } },
      },
    },
  )).toBe(true)
  Expect(StudioSketchChanges.equal(
    { ...sketch.rects[0]!, fieldBinding: binding },
    { ...sketch.rects[0]!, fieldBinding: { ...binding, path: 'Owner' } },
  )).toBe(false)

  const added = { ...sketch.rects[0]!, id: 'added' }
  const optimisticallyAdded = StudioSketchChanges.settle([sketch], {
    kind: 'add',
    rect: added,
    sketchId: sketch.id,
  })[0]!
  Expect(optimisticallyAdded.rects.map(rect => rect.id)).toEqual(['back', 'front', 'added'])
  Expect(optimisticallyAdded.rectOrder).toEqual(['back', 'front', 'added'])

  const optimisticallyDuplicated = StudioSketchChanges.settle([sketch], {
    kind: 'duplicate',
    rect: copy,
    sketchId: sketch.id,
    sourceRectId: sketch.rects[0]!.id,
  })[0]!
  Expect(optimisticallyDuplicated.rects.map(rect => rect.id)).toEqual(['back', 'copy', 'front'])
  Expect(optimisticallyDuplicated.rectOrder).toEqual(['back', 'copy', 'front'])
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
    content: 'render Text("Front")',
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
    x: 24,
    y: 24,
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
  return { formatVersion: 1 as const, nextViewNumber: 2, revision, sketches: [sketch] }
}

function snapProposal(requestId: string, needsConfirmation: boolean): StudioSketchSnapProposalResult {
  return {
    content: 'render Text("Front")',
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

Test('Studio sketch render gate holds re-renders while a gesture is in flight and flushes the latest one', () => {
  const idle = StudioSketchRenderGate.initial()
  const first = [testSketch()]
  Expect(StudioSketchRenderGate.request(idle, first, 'source-1')).toEqual({ render: true, state: idle })

  let gate = StudioSketchRenderGate.begin(idle)
  const held = StudioSketchRenderGate.request(gate, first, 'source-2')
  Expect(held.render).toBe(false)
  gate = held.state
  const second = [{ ...testSketch(), rects: [] }]
  const later = StudioSketchRenderGate.request(gate, second)
  Expect(later.render).toBe(false)
  gate = later.state

  // A nested gesture (a resize handle inside a captured board) keeps the hold until both end.
  gate = StudioSketchRenderGate.begin(gate)
  const inner = StudioSketchRenderGate.end(gate)
  Expect(inner.flush).toBeUndefined()
  const outer = StudioSketchRenderGate.end(inner.state)
  Expect(outer.flush).toEqual({ sketches: second, sourceVersion: 'source-2' })
  Expect(outer.state).toEqual(idle)
  Expect(StudioSketchRenderGate.end(idle).flush).toBeUndefined()
})

Test('Studio sketch board pointerdown begins a gesture only for a free primary pointer on the canvas', () => {
  const canvas = { inToolbar: false, onHandle: false, primary: true }
  Expect(StudioSketchBoardInput.beginsGesture(canvas)).toBe(true)
  Expect(StudioSketchBoardInput.beginsGesture({ ...canvas, inToolbar: true })).toBe(false)
  Expect(StudioSketchBoardInput.beginsGesture({ ...canvas, onHandle: true })).toBe(false)
  Expect(StudioSketchBoardInput.beginsGesture({ ...canvas, primary: false })).toBe(false)
  Expect(StudioSketchBoardInput.beginsGesture({ ...canvas, activePointer: 7 })).toBe(false)
})

Test('Studio drag-one-in snaps only a plain move released outside the board over the running cell', () => {
  const size = { height: 76, width: 360 }
  const outside = { x: 420, y: 30 }
  Expect(StudioSketchDragOneIn.outcome({ duplicate: false, overCell: true, point: outside, size })).toBe('snap')
  Expect(StudioSketchDragOneIn.outcome({ duplicate: false, overCell: false, point: outside, size })).toBe('move')
  Expect(StudioSketchDragOneIn.outcome({ duplicate: true, overCell: true, point: outside, size })).toBe('move')
  Expect(StudioSketchDragOneIn.outcome({ duplicate: false, overCell: true, point: { x: 100, y: 30 }, size })).toBe(
    'move',
  )
})

Test('Studio drag-one-in resolves the sketch-owned visible drop target', () => {
  const target = {
    closest(selector: string) {
      Expect(selector).toBe('[data-tao-studio-sketch-drop-target]')
      return { dataset: { taoStudioSketchDropTarget: 'sketch-1' } }
    },
  }
  Expect(StudioSketchDragTarget.owns(target, 'sketch-1')).toBe(true)
  Expect(StudioSketchDragTarget.owns(target, 'sketch-2')).toBe(false)
  Expect(StudioSketchDragTarget.owns(null, 'sketch-1')).toBe(false)
})

Test('mounted drag-one-in sees through its moved rectangle and holds capture until Snap settles', async () => {
  const dom = new SketchTestDocument()
  const host = dom.createElement('main')
  const snap = Deferred<StudioSketchSnapApplyResult>()
  const requests: unknown[] = []
  const mounted = StudioSketchView.mount(host as unknown as HTMLElement, {
    onSnap: request => {
      requests.push(request)
      return snap.promise
    },
    sketches: [testSketch()],
    sourceVersion: 'source-1',
  })
  const board = dom.find(host, 'taoStudioSketch', 'sketch-1')
  const rect = dom.find(board, 'taoStudioSketchRect', 'back')
  const dropTarget = dom.find(host, 'taoStudioSketchDropTarget', 'sketch-1')
  dom.hitTest = [rect, dropTarget]

  board.dispatch('pointerdown', pointer('pointerdown', rect, 1, 15, 15))
  board.dispatch('pointermove', pointer('pointermove', rect, 1, 420, 30))
  board.dispatch('pointerup', pointer('pointerup', rect, 1, 420, 30))

  Expect(requests).toHaveLength(1)
  Expect(requests[0]).toMatchObject({ rectIds: ['back'], sketchId: 'sketch-1', sourceVersion: 'source-1' })
  Expect(board.releasedPointers).toEqual([])
  mounted.render([{ ...testSketch(), rects: [] }])
  Expect(dom.find(host, 'taoStudioSketch', 'sketch-1')).toBe(board)

  snap.resolve(snapApply(catalog(2, testSketch()), 'request-mounted', 'checkpoint-mounted'))
  await snap.promise
  await Promise.resolve()
  await Promise.resolve()
  Expect(board.releasedPointers).toEqual([1])
  mounted.dispose()
})

Test('Studio pointer release keeps the render gate held until an asynchronous catalog commit settles', async () => {
  const persistence = Deferred<void>()
  const order: string[] = []
  StudioSketchPointerRelease.afterCommit(
    () => {
      order.push('commit')
      return persistence.promise.then(() => {
        order.push('settled')
      })
    },
    () => {
      order.push('release')
    },
  )
  await Promise.resolve()
  Expect(order).toEqual(['commit'])
  persistence.resolve()
  await persistence.promise
  await Promise.resolve()
  Expect(order).toEqual(['commit', 'settled', 'release'])
})

Test('successful sketch work clears board and persistent host errors', () => {
  const host = { closest: () => null, dataset: { taoStudioSketchError: 'old host failure' } }
  const board = {
    closest: (selector: string) => {
      Expect(selector).toBe('[data-tao-studio-sketch-error]')
      return host
    },
    dataset: { taoStudioSketchError: 'old board failure' },
  }
  StudioSketchErrors.clear(board)
  Expect(board.dataset.taoStudioSketchError).toBeUndefined()
  Expect(host.dataset.taoStudioSketchError).toBeUndefined()
})

type SketchTestEvent = Readonly<Record<string, unknown> & { target: SketchTestElement; type: string }>

function pointer(
  type: string,
  target: SketchTestElement,
  pointerId: number,
  clientX: number,
  clientY: number,
): SketchTestEvent {
  return {
    altKey: false,
    button: 0,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    preventDefault() {},
    shiftKey: false,
    target,
    type,
  }
}

class SketchTestDocument {
  hitTest: SketchTestElement[] = []

  createElement(tagName: string): SketchTestElement {
    return new SketchTestElement(this, tagName)
  }

  elementFromPoint(): SketchTestElement | null {
    return this.hitTest[0] ?? null
  }

  elementsFromPoint(): SketchTestElement[] {
    return this.hitTest
  }

  find(root: SketchTestElement, datasetName: string, value: string): SketchTestElement {
    const found = root.descendants().find(element => element.dataset[datasetName] === value)
    Assert.defined(found, `mounted sketch element ${datasetName}=${value}`)
    return found
  }
}

class SketchTestElement {
  ariaLabel = ''
  readonly children: SketchTestElement[] = []
  readonly dataset: Record<string, string | undefined> = {}
  disabled = false
  hidden = false
  readonly listeners = new Map<string, Array<(event: never) => void>>()
  multiple = false
  parent: SketchTestElement | undefined
  readonly releasedPointers: number[] = []
  selected = false
  readonly style: Record<string, string> = {}
  textContent = ''
  title = ''
  type = ''
  value = ''

  constructor(readonly ownerDocument: SketchTestDocument, readonly tagName: string) {}

  get selectedOptions(): SketchTestElement[] {
    return this.children.filter(child => child.selected)
  }

  add(child: SketchTestElement): void {
    this.append(child)
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  append(...children: SketchTestElement[]): void {
    for (const child of children) {
      child.parent = this
      this.children.push(child)
    }
  }

  closest(selector: string): SketchTestElement | null {
    const name = dataSelectorName(selector)
    for (let current: SketchTestElement | undefined = this; current !== undefined; current = current.parent) {
      if (name !== undefined && current.dataset[name] !== undefined) {
        return current
      }
    }
    return null
  }

  contains(candidate: SketchTestElement | null): boolean {
    return candidate !== null && (candidate === this || this.children.some(child => child.contains(candidate)))
  }

  descendants(): SketchTestElement[] {
    return [this, ...this.children.flatMap(child => child.descendants())]
  }

  dispatch(type: string, event: SketchTestEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as never)
    }
  }

  getBoundingClientRect(): DOMRect {
    return { bottom: 0, height: 0, left: 0, right: 0, toJSON: () => ({}), top: 0, width: 0, x: 0, y: 0 }
  }

  querySelector(selector: string): SketchTestElement | null {
    const name = dataSelectorName(selector)
    return name === undefined
      ? null
      : this.children.find(child => child.dataset[name] !== undefined) ?? null
  }

  releasePointerCapture(pointerId: number): void {
    this.releasedPointers.push(pointerId)
  }

  remove(): void {
    if (this.parent === undefined) {
      return
    }
    const index = this.parent.children.indexOf(this)
    if (index >= 0) {
      this.parent.children.splice(index, 1)
    }
    this.parent = undefined
  }

  replaceChildren(...children: SketchTestElement[]): void {
    for (const child of this.children) {
      child.parent = undefined
    }
    this.children.splice(0)
    this.append(...children)
  }

  setPointerCapture(): void {}
}

function dataSelectorName(selector: string): string | undefined {
  const match = selector.match(/data-tao-studio-([a-z-]+)/)
  return match?.[1]?.split('-').reduce(
    (name, part) => `${name}${part[0]?.toUpperCase()}${part.slice(1)}`,
    'taoStudio',
  )
}
