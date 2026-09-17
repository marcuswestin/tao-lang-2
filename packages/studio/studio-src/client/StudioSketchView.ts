import type {
  StudioSketchFlowAction,
  StudioSketchSnapApplyResult,
  StudioSketchSnapProposalResult,
  StudioSketchSnapUndoResult,
} from '../StudioProjectSession'
import type { StudioSketch, StudioSketchRect } from '../StudioSketchCatalog'
import { canvasScale } from './matrix/StudioCanvasViewport'
import {
  StudioSketchGeometry,
  type StudioSketchGeometryState,
  type StudioSketchPoint,
  type StudioSketchResizeHandle,
} from './StudioSketchGeometry'

export type StudioSketchRectChange = Readonly<{
  kind: 'add' | 'duplicate' | 'update'
  rect: StudioSketchRect
  sketchId: string
  sourceRectId?: string
}>

export const StudioSketchChanges = {
  equal(left: StudioSketchRect, right: StudioSketchRect): boolean {
    return left.id === right.id
      && left.kind === right.kind
      && left.x === right.x
      && left.y === right.y
      && left.width === right.width
      && left.height === right.height
      && left.content === right.content
      && equalFieldBinding(left.fieldBinding, right.fieldBinding)
  },
  settle(
    sketches: readonly StudioSketch[],
    change: StudioSketchRectChange,
    authoritative?: readonly StudioSketch[],
  ): readonly StudioSketch[] {
    if (authoritative !== undefined) {
      return authoritative
    }
    return sketches.map(sketch => sketch.id === change.sketchId ? settleSketchChange(sketch, change) : sketch)
  },
} as const

function equalFieldBinding(
  left: StudioSketchRect['fieldBinding'],
  right: StudioSketchRect['fieldBinding'],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }
  return left.parameter === right.parameter
    && left.path === right.path
    && left.presentation.kind === right.presentation.kind
    && left.presentation.label?.path === right.presentation.label?.path
    && left.presentation.label?.prefix === right.presentation.label?.prefix
    && left.presentation.label?.suffix === right.presentation.label?.suffix
}

function settleSketchChange(sketch: StudioSketch, change: StudioSketchRectChange): StudioSketch {
  if (change.kind === 'update') {
    return {
      ...sketch,
      rects: sketch.rects.map(rect => rect.id === change.rect.id ? change.rect : rect),
    }
  }
  const rects = [...sketch.rects]
  const rectOrder = [...sketch.rectOrder]
  const sourceRectIndex = change.kind === 'duplicate'
    ? sketch.rects.findIndex(rect => rect.id === change.sourceRectId)
    : -1
  const sourceOrderIndex = change.kind === 'duplicate'
    ? sketch.rectOrder.indexOf(change.sourceRectId ?? '')
    : -1
  rects.splice(sourceRectIndex < 0 ? rects.length : sourceRectIndex + 1, 0, change.rect)
  rectOrder.splice(sourceOrderIndex < 0 ? rectOrder.length : sourceOrderIndex + 1, 0, change.rect.id)
  return { ...sketch, rectOrder, rects }
}

export type StudioSketchViewOptions = Readonly<{
  onCreateSketch?: (input: Readonly<{ height: number; width: number; x: number; y: number }>) => Promise<void> | void
  onError?: (error: unknown) => void
  onFlowAction?: (request: StudioSketchViewFlowActionRequest) => Promise<StudioSketchSnapApplyResult>
  onRectChange?: (
    change: StudioSketchRectChange,
  ) => Promise<readonly StudioSketch[] | void> | readonly StudioSketch[] | void
  onSnap?: (
    request: StudioSketchViewSnapRequest,
  ) => Promise<StudioSketchSnapApplyResult | StudioSketchSnapProposalResult>
  onUnsnap?: (request: StudioSketchViewUnsnapRequest) => Promise<StudioSketchSnapApplyResult>
  onUndoSnap?: (request: StudioSketchViewUndoRequest) => Promise<StudioSketchSnapUndoResult>
  sketches: readonly StudioSketch[]
  sourceVersion?: string
  sourceVersions?: Readonly<Record<string, string>>
}>

type StudioSketchViewSnapRequest = Readonly<{
  checkpointId: string
  confirmedProposalVersion?: string
  rectIds: readonly string[]
  sketchId: string
  sourceVersion: string
}>

export type StudioSketchViewFlowActionRequest = Readonly<{
  action: StudioSketchFlowAction
  checkpointId: string
  sketchId: string
  sourceVersion: string
}>

type StudioSketchViewUndoRequest = Readonly<{
  checkpointId: string
  sourceVersion: string
}>

type StudioSketchSnapUiState = {
  lastCheckpointId?: string
  pending?: StudioSketchSnapProposalResult
  pendingCheckpointId?: string
  sourceVersion?: string
}

type StudioSketchViewUnsnapRequest = Readonly<{
  checkpointId: string
  rectIds: readonly string[]
  sketchId: string
  sourceVersion: string
}>

export const StudioSketchViewNames = {
  next(sketches: readonly Pick<StudioSketch, 'view'>[]): string {
    let next = 1
    for (const sketch of sketches) {
      const match = /^View([1-9][0-9]*)$/u.exec(sketch.view)
      if (match !== null) {
        next = Math.max(next, Number(match[1]) + 1)
      }
    }
    return `View${next}`
  },
} as const

export const StudioSketchSelection = {
  rectIds(sketch: StudioSketch, selected: ReadonlySet<string>): readonly string[] {
    const chosen = sketch.rects.filter(rect => selected.has(rect.id)).map(rect => rect.id)
    return chosen.length === 0 ? sketch.rects.map(rect => rect.id) : chosen
  },
  settle(sketch: StudioSketch, selected: ReadonlySet<string>): ReadonlySet<string> {
    const free = new Set(sketch.rects.map(rect => rect.id))
    return new Set([...selected].filter(id => free.has(id)))
  },
  toggle(selected: ReadonlySet<string>, rectId: string, multiple: boolean): ReadonlySet<string> {
    if (!multiple) {
      return new Set([rectId])
    }
    const next = new Set(selected)
    if (next.has(rectId)) {
      next.delete(rectId)
    } else {
      next.add(rectId)
    }
    return next
  },
} as const

export const StudioSketchFlowControls = {
  availability(selectedCount: number, endpointAvailable: boolean, sourceAvailable: boolean) {
    const unavailableReason = !endpointAvailable
      ? 'Flow action endpoint is unavailable.'
      : !sourceAvailable
      ? 'Flow editing requires the generated view source version.'
      : undefined
    const commonReason = unavailableReason ?? (selectedCount < 1 ? 'Select at least one snapped rectangle.' : '')
    return {
      direction: { disabled: unavailableReason !== undefined || selectedCount < 1, reason: commonReason },
      separator: { disabled: unavailableReason !== undefined || selectedCount < 1, reason: commonReason },
      spacer: {
        disabled: unavailableReason !== undefined || selectedCount !== 2,
        reason: unavailableReason ?? (selectedCount !== 2 ? 'Select exactly two snapped rectangles.' : ''),
      },
    } as const
  },
  spacerAction(rectIds: readonly string[], sliderValue: number): StudioSketchFlowAction | undefined {
    if (rectIds.length !== 2 || !Number.isSafeInteger(sliderValue) || sliderValue < 1 || sliderValue > 99) {
      return undefined
    }
    return {
      afterRectId: rectIds[0]!,
      beforeRectId: rectIds[1]!,
      kind: 'insert-spacer',
      ratio: [sliderValue, 100 - sliderValue],
    }
  },
} as const

export const StudioSketchProposal = {
  cancel(): undefined {
    return undefined
  },
  confirmation(proposal: StudioSketchSnapProposalResult): Readonly<{
    confirmedProposalVersion: string
    rectIds: readonly string[]
  }> {
    return {
      confirmedProposalVersion: proposal.proposedSourceVersion,
      rectIds: proposal.projectedRectIds,
    }
  },
} as const

export type StudioSketchRenderGateState = Readonly<{
  activeGestures: number
  deferred?: Readonly<{ sketches: readonly StudioSketch[]; sourceVersion?: string }>
}>

/**
 * StudioSketchRenderGate keeps a catalog or manifest re-render from replacing a board while a
 * pointer gesture is in flight on it. Replacing the board would drop the captured pointer and lose
 * the gesture, so the latest render request is held and flushed when the last gesture ends.
 */
export const StudioSketchRenderGate = {
  begin(state: StudioSketchRenderGateState): StudioSketchRenderGateState {
    return { ...state, activeGestures: state.activeGestures + 1 }
  },
  end(state: StudioSketchRenderGateState): Readonly<{
    flush?: Readonly<{ sketches: readonly StudioSketch[]; sourceVersion?: string }>
    state: StudioSketchRenderGateState
  }> {
    const activeGestures = Math.max(0, state.activeGestures - 1)
    if (activeGestures > 0 || state.deferred === undefined) {
      return { state: { ...state, activeGestures } }
    }
    return { flush: state.deferred, state: { activeGestures } }
  },
  initial(): StudioSketchRenderGateState {
    return { activeGestures: 0 }
  },
  request(
    state: StudioSketchRenderGateState,
    sketches: readonly StudioSketch[],
    sourceVersion?: string,
  ): Readonly<{ render: boolean; state: StudioSketchRenderGateState }> {
    if (state.activeGestures === 0) {
      return { render: true, state }
    }
    const version = sourceVersion ?? state.deferred?.sourceVersion
    return {
      render: false,
      state: { ...state, deferred: { sketches, ...(version === undefined ? {} : { sourceVersion: version }) } },
    }
  },
} as const

export type StudioSketchBoardPointer = Readonly<{
  activePointer?: number
  inToolbar: boolean
  onHandle: boolean
  primary: boolean
}>

/**
 * StudioSketchBoardInput decides whether a board pointerdown begins a geometry gesture. Toolbar
 * controls and resize handles keep their own native or dedicated handling; a second pointer while
 * one is captured is ignored so a stray touch cannot complete another gesture.
 */
export const StudioSketchBoardInput = {
  beginsGesture(pointer: StudioSketchBoardPointer): boolean {
    return pointer.activePointer === undefined && pointer.primary && !pointer.inToolbar && !pointer.onHandle
  },
} as const

export type StudioSketchMoveRelease = Readonly<{
  duplicate: boolean
  overCell: boolean
  point: StudioSketchPoint
  size: Readonly<{ height: number; width: number }>
}>

/**
 * StudioSketchDragOneIn decides what releasing a moved rectangle means. Inside the board the move
 * stands; released over the sketch's own running cell, the rectangle is snapped into that view's
 * flow instead and its free geometry is restored (FS-D11's drag-one-in). Duplicates never snap.
 */
export const StudioSketchDragOneIn = {
  outcome(release: StudioSketchMoveRelease): 'move' | 'snap' {
    const inside = release.point.x >= 0
      && release.point.y >= 0
      && release.point.x <= release.size.width
      && release.point.y <= release.size.height
    return !inside && release.overCell && !release.duplicate ? 'snap' : 'move'
  },
} as const

type StudioSketchClosestTarget = Readonly<{
  closest(selector: string): Readonly<{ dataset?: DOMStringMap | Readonly<Record<string, string>> }> | null
}>

/** StudioSketchDragTarget authenticates the visible drop affordance as belonging to this sketch. */
export const StudioSketchDragTarget = {
  owns(target: StudioSketchClosestTarget | null, sketchId: string): boolean {
    const dropTarget = target?.closest('[data-tao-studio-sketch-drop-target]')
    return dropTarget?.dataset?.['taoStudioSketchDropTarget'] === sketchId
  },
  ownsAny(targets: readonly StudioSketchClosestTarget[], sketchId: string): boolean {
    return targets.some(target => StudioSketchDragTarget.owns(target, sketchId))
  },
} as const

type StudioSketchErrorElement = Readonly<{
  dataset: Record<string, string | undefined> | DOMStringMap
  closest(selector: string): unknown
}>

/** Successful sketch operations clear both the board marker and the longer-lived Draw host marker. */
export const StudioSketchErrors = {
  clear(board: StudioSketchErrorElement): void {
    delete board.dataset['taoStudioSketchError']
    const host = board.closest('[data-tao-studio-sketch-error]') as
      | Readonly<{ dataset: Record<string, string | undefined> | DOMStringMap }>
      | null
    if (host !== null) {
      delete host.dataset['taoStudioSketchError']
    }
  },
} as const

/** A captured pointer is released only after its catalog commit has settled and queued its render. */
export const StudioSketchPointerRelease = {
  afterCommit(commit: () => Promise<unknown> | unknown, release: () => void): void {
    try {
      const result = commit()
      if (result instanceof Promise) {
        void result.then(release, release)
      } else {
        release()
      }
    } catch {
      release()
    }
  },
} as const

export type MountedStudioSketchView = Readonly<{
  dispose(): void
  render(sketches: readonly StudioSketch[], sourceVersions?: Readonly<Record<string, string>>): void
}>

export type StudioSketchOuterGesture = Readonly<{
  origin: StudioSketchPoint
  pointerId: number
}>

export const StudioSketchOuterDrawing = {
  begin(
    gesture: StudioSketchOuterGesture | undefined,
    pointerId: number,
    origin: StudioSketchPoint,
  ): StudioSketchOuterGesture | undefined {
    return gesture ?? { origin, pointerId }
  },
  cancel(gesture: StudioSketchOuterGesture | undefined, pointerId: number): StudioSketchOuterGesture | undefined {
    return gesture?.pointerId === pointerId ? undefined : gesture
  },
  end(
    gesture: StudioSketchOuterGesture | undefined,
    pointerId: number,
    point: StudioSketchPoint,
  ): Readonly<{
    gesture?: StudioSketchOuterGesture
    preview?: Readonly<{ height: number; width: number; x: number; y: number }>
    size?: Readonly<{ height: number; width: number; x: number; y: number }>
  }> {
    if (gesture === undefined || gesture.pointerId !== pointerId) {
      return { gesture }
    }
    const preview = rectFromPoints(gesture.origin, point)
    return preview.width < StudioSketchGeometry.minimumDrawExtent
        || preview.height < StudioSketchGeometry.minimumDrawExtent
      ? {}
      : { preview, size: preview }
  },
  preview(
    gesture: StudioSketchOuterGesture | undefined,
    point: StudioSketchPoint,
  ): Readonly<{ height: number; width: number; x: number; y: number }> | undefined {
    if (gesture === undefined) {
      return undefined
    }
    const preview = rectFromPoints(gesture.origin, point)
    return preview.width < StudioSketchGeometry.minimumDrawExtent
        || preview.height < StudioSketchGeometry.minimumDrawExtent
      ? undefined
      : preview
  },
} as const

function rectFromPoints(
  origin: StudioSketchPoint,
  point: StudioSketchPoint,
): Readonly<{ height: number; width: number; x: number; y: number }> {
  const first = { x: Math.max(0, origin.x), y: Math.max(0, origin.y) }
  const second = { x: Math.max(0, point.x), y: Math.max(0, point.y) }
  const width = Math.round(Math.abs(second.x - first.x))
  const height = Math.round(Math.abs(second.y - first.y))
  return {
    height,
    width,
    x: Math.round(Math.min(first.x, second.x)),
    y: Math.round(Math.min(first.y, second.y)),
  }
}

const handles: readonly StudioSketchResizeHandle[] = [
  'north-west',
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
]

/** StudioSketchView mounts the free-geometry overlay without owning catalog persistence. */
export const StudioSketchView = {
  mount(host: HTMLElement, options: StudioSketchViewOptions): MountedStudioSketchView {
    const document = host.ownerDocument
    const workspace = document.createElement('section')
    workspace.dataset['taoStudioSketchWorkspace'] = 'true'
    workspace.style.display = 'flex'
    workspace.style.gap = '16px'
    workspace.style.minHeight = '100%'
    workspace.style.minWidth = '100%'
    workspace.style.overflow = 'visible'
    workspace.style.padding = '24px'
    const inspector = document.createElement('aside')
    inspector.dataset['taoStudioSketchInspector'] = 'true'
    inspector.hidden = true
    inspector.style.width = '180px'
    let sketches = options.sketches
    let currentSourceVersion = options.sourceVersion
    let viewSourceVersions: Record<string, string> = { ...options.sourceVersions }
    const snapStates = new Map<string, StudioSketchSnapUiState>()
    let selected: Readonly<{ rectId: string; rectIds: ReadonlySet<string>; sketchId: string }> | undefined
    let outerGesture: StudioSketchOuterGesture | undefined
    let gate = StudioSketchRenderGate.initial()
    const gestureLock: StudioSketchGestureLock = {
      begin() {
        gate = StudioSketchRenderGate.begin(gate)
      },
      end() {
        const result = StudioSketchRenderGate.end(gate)
        gate = result.state
        if (result.flush !== undefined) {
          renderNow(result.flush.sketches, result.flush.sourceVersion)
        }
      },
    }

    const applyChange = (change: StudioSketchRectChange): void => {
      sketches = StudioSketchChanges.settle(sketches, change)
      selected = { rectId: change.rect.id, rectIds: new Set([change.rect.id]), sketchId: change.sketchId }
      render(sketches)
    }
    const commit = (change: StudioSketchRectChange): Promise<void> | void => {
      const settle = (authoritative: readonly StudioSketch[] | void): void => {
        if (authoritative === undefined) {
          applyChange(change)
        } else {
          render(StudioSketchChanges.settle(sketches, change, authoritative))
        }
      }
      try {
        const result = options.onRectChange?.(change)
        if (result instanceof Promise) {
          return result.then(settle, error => {
            options.onError?.(error)
            render(sketches)
          })
        } else {
          settle(result)
        }
      } catch (error) {
        options.onError?.(error)
        render(sketches)
      }
    }

    const render = (
      nextSketches: readonly StudioSketch[],
      nextSourceVersions?: Readonly<Record<string, string>>,
    ): void => {
      if (nextSourceVersions !== undefined) {
        viewSourceVersions = { ...viewSourceVersions, ...nextSourceVersions }
      }
      const decision = StudioSketchRenderGate.request(gate, nextSketches, currentSourceVersion)
      gate = decision.state
      if (decision.render) {
        renderNow(nextSketches)
      }
    }
    const renderNow = (nextSketches: readonly StudioSketch[], nextSourceVersion?: string): void => {
      sketches = nextSketches
      currentSourceVersion = nextSourceVersion ?? currentSourceVersion
      if (selected !== undefined) {
        const sketch = sketches.find(candidate => candidate.id === selected?.sketchId)
        if (sketch !== undefined) {
          const rectIds = StudioSketchSelection.settle(sketch, selected.rectIds)
          selected = rectIds.size === 0 ? undefined : { ...selected, rectIds }
        }
      }
      const boards = sketches.map(sketch =>
        renderSketch(
          document,
          sketch,
          (() => {
            const version = viewSourceVersions[sketch.view] ?? currentSourceVersion
            const state = snapStates.get(sketch.id) ?? { sourceVersion: version }
            state.sourceVersion = version ?? state.sourceVersion
            snapStates.set(sketch.id, state)
            return state
          })(),
          () => selected,
          value => {
            selected = value
            renderInspector(inspector, sketches, selected, commit)
          },
          commit,
          options.onFlowAction,
          options.onSnap,
          options.onUnsnap,
          options.onUndoSnap,
          (authoritative, version) => {
            viewSourceVersions[sketch.view] = version
            currentSourceVersion = version
            render(authoritative)
          },
          gestureLock,
          options.onError,
        )
      )
      workspace.replaceChildren(...boards, inspector)
      renderInspector(inspector, sketches, selected, commit)
    }
    workspace.addEventListener('pointerdown', event => {
      if (event.target !== workspace || outerGesture !== undefined || !primaryPointer(event)) {
        return
      }
      outerGesture = StudioSketchOuterDrawing.begin(outerGesture, event.pointerId, relativePoint(workspace, event))
      workspace.setPointerCapture?.(event.pointerId)
      workspace.dataset['taoStudioSketchDrawing'] = 'outer'
      gestureLock.begin()
      event.preventDefault()
    })
    workspace.addEventListener('pointermove', event => {
      if (event.pointerId !== outerGesture?.pointerId) {
        return
      }
      paintOuterPreview(workspace, StudioSketchOuterDrawing.preview(outerGesture, relativePoint(workspace, event)))
    })
    const finishOuter = (event: PointerEvent): void => {
      if (event.pointerId !== outerGesture?.pointerId) {
        return
      }
      const result = StudioSketchOuterDrawing.end(
        outerGesture,
        event.pointerId,
        relativePoint(workspace, event),
      )
      outerGesture = undefined
      workspace.releasePointerCapture?.(event.pointerId)
      delete workspace.dataset['taoStudioSketchDrawing']
      gestureLock.end()
      if (result.size === undefined) {
        paintOuterPreview(workspace, undefined)
        return
      }
      paintOuterPreview(workspace, undefined)
      const optimisticId = crypto.randomUUID()
      const name = StudioSketchViewNames.next(sketches)
      sketches = [
        ...sketches,
        {
          height: result.size.height,
          id: optimisticId,
          name,
          project: sketches[0]?.project ?? '',
          rectOrder: [],
          rects: [],
          snapped: [],
          view: name,
          width: result.size.width,
          x: result.size.x,
          y: result.size.y,
        },
      ]
      render(sketches)
      try {
        const persistence = options.onCreateSketch?.(result.size)
        if (persistence instanceof Promise) {
          void persistence.catch(error => {
            sketches = sketches.filter(sketch => sketch.id !== optimisticId)
            render(sketches)
            options.onError?.(error)
          })
        }
      } catch (error) {
        sketches = sketches.filter(sketch => sketch.id !== optimisticId)
        render(sketches)
        options.onError?.(error)
      }
    }
    workspace.addEventListener('pointerup', finishOuter)
    const cancelOuter = (event: PointerEvent): void => {
      if (event.pointerId !== outerGesture?.pointerId) {
        return
      }
      outerGesture = StudioSketchOuterDrawing.cancel(outerGesture, event.pointerId)
      try {
        workspace.releasePointerCapture?.(event.pointerId)
      } catch {
        // The capture was already gone.
      }
      delete workspace.dataset['taoStudioSketchDrawing']
      paintOuterPreview(workspace, undefined)
      gestureLock.end()
    }
    workspace.addEventListener('pointercancel', cancelOuter)
    workspace.addEventListener('lostpointercapture', cancelOuter)
    host.append(workspace)
    render(sketches)
    return {
      dispose() {
        workspace.remove()
      },
      render,
    }
  },
} as const

type StudioSketchGestureLock = Readonly<{
  begin(): void
  end(): void
}>

function renderSketch(
  document: Document,
  sketch: StudioSketch,
  snapState: StudioSketchSnapUiState,
  selection: () => Readonly<{ rectId: string; rectIds: ReadonlySet<string>; sketchId: string }> | undefined,
  select: (value: Readonly<{ rectId: string; rectIds: ReadonlySet<string>; sketchId: string }> | undefined) => void,
  onChange: (change: StudioSketchRectChange) => Promise<void> | void,
  onFlowAction: StudioSketchViewOptions['onFlowAction'],
  onSnap: StudioSketchViewOptions['onSnap'],
  onUnsnap: StudioSketchViewOptions['onUnsnap'],
  onUndoSnap: StudioSketchViewOptions['onUndoSnap'],
  renderAuthoritative: (sketches: readonly StudioSketch[], sourceVersion: string) => void,
  gestureLock: StudioSketchGestureLock,
  onError: StudioSketchViewOptions['onError'],
): HTMLElement {
  // The frame stacks the toolbar above the board and the proposal below it. Nothing but rectangles
  // may sit inside the board: an absolutely positioned toolbar once wrapped down over it and the
  // pointer landed on Unsnap instead of the drawing surface.
  const frame = document.createElement('section')
  frame.dataset['taoStudioSketchFrame'] = sketch.id
  frame.style.alignItems = 'flex-start'
  frame.style.display = 'flex'
  frame.style.flexDirection = 'column'
  frame.style.gap = '6px'
  frame.style.left = `${sketch.x}px`
  frame.style.position = 'absolute'
  frame.style.top = `${sketch.y}px`
  const name = document.createElement('span')
  name.dataset['taoStudioSketchName'] = sketch.id
  name.textContent = sketch.name
  name.style.left = '0'
  name.style.position = 'absolute'
  name.style.top = '-20px'
  const board = document.createElement('section')
  board.dataset['taoStudioSketch'] = sketch.id
  board.style.height = `${sketch.height}px`
  board.style.minWidth = `${sketch.width}px`
  board.style.position = 'relative'
  board.style.width = `${sketch.width}px`
  let activePointer: number | undefined
  let duplicateSourceId: string | undefined
  let busy = false
  /** A failure is shown on the board and reported to the host, which outlives a re-rendered board. */
  const reportError = (error: unknown): void => {
    board.dataset['taoStudioSketchError'] = error instanceof Error ? error.message : String(error)
    onError?.(error)
  }
  const clearError = (): void => StudioSketchErrors.clear(board)
  let state: StudioSketchGeometryState = StudioSketchGeometry.initial(sketch.rects)
  // The in-flight gesture is published on the board so a person, a stylesheet, or a browser lane
  // can see that the pointer reached it before any catalog write is expected.
  const capturePointer = (pointerId: number): void => {
    activePointer = pointerId
    board.setPointerCapture?.(pointerId)
    board.dataset['taoStudioSketchGesture'] = state.gesture?.kind ?? 'gesture'
    gestureLock.begin()
  }
  // Idempotent: a pointerup releases, and the lostpointercapture that follows must not end the
  // gesture lock a second time or release a pointer that already belongs to the next gesture.
  const releasePointer = (pointerId: number): void => {
    if (activePointer !== pointerId) {
      return
    }
    activePointer = undefined
    try {
      board.releasePointerCapture?.(pointerId)
    } catch {
      // The capture was already gone; the browser dropped it before this ran.
    }
    delete board.dataset['taoStudioSketchGesture']
    gestureLock.end()
  }
  if (selection()?.sketchId === sketch.id) {
    state = { ...state, selectedId: selection()?.rectId }
  }
  const paint = (): void => {
    const selectedIds = selection()?.sketchId === sketch.id
      ? selection()?.rectIds ?? new Set<string>()
      : new Set<string>()
    const children = state.rects.map(rect => rectElement(document, rect, selectedIds.has(rect.id), beginResize))
    board.replaceChildren(gapIndicator, ...children)
    // The toolbar and board stay attached; re-inserting the board would momentarily disconnect the
    // element holding pointer capture. Only the proposal comes and goes.
    frame.querySelector(':scope > [data-tao-studio-sketch-snap-proposal]')?.remove()
    if (snapState.pending !== undefined) {
      frame.append(proposalElement())
    }
  }
  const toolbar = document.createElement('nav')
  toolbar.dataset['taoStudioSketchSnapControls'] = sketch.id
  toolbar.style.alignItems = 'center'
  toolbar.style.display = 'flex'
  toolbar.style.flexWrap = 'wrap'
  toolbar.style.gap = '4px'
  toolbar.style.maxWidth = `${Math.max(sketch.width, 360)}px`
  const snap = document.createElement('button')
  snap.textContent = 'Snap'
  snap.dataset['taoStudioSketchSnap'] = sketch.id
  const undo = document.createElement('button')
  undo.textContent = 'Undo Snap'
  undo.dataset['taoStudioSketchSnapUndo'] = sketch.id
  undo.disabled = onUndoSnap === undefined || snapState.lastCheckpointId === undefined
  const snapped = document.createElement('select')
  snapped.ariaLabel = 'Snapped rectangles'
  snapped.multiple = true
  for (const association of sketch.snapped) {
    const option = document.createElement('option')
    option.value = association.rect.id
    option.textContent = association.rect.content ?? association.rect.kind
    snapped.add(option)
  }
  const unsnap = document.createElement('button')
  unsnap.textContent = 'Unsnap'
  unsnap.dataset['taoStudioSketchUnsnap'] = sketch.id
  unsnap.disabled = onUnsnap === undefined || snapState.sourceVersion === undefined || sketch.snapped.length === 0
  const direction = document.createElement('button')
  direction.textContent = 'Toggle direction'
  direction.dataset['taoStudioSketchFlowDirection'] = sketch.id
  const separator = document.createElement('button')
  separator.textContent = 'Insert separator'
  separator.dataset['taoStudioSketchFlowSeparator'] = sketch.id
  const spacerLabel = document.createElement('label')
  spacerLabel.textContent = 'Spacer ratio 1:1'
  spacerLabel.dataset['taoStudioSketchFlowSpacerLabel'] = sketch.id
  const spacer = document.createElement('input')
  spacer.type = 'range'
  spacer.min = '1'
  spacer.max = '99'
  spacer.value = '50'
  spacer.ariaLabel = 'Spacer claim ratio'
  spacer.dataset['taoStudioSketchFlowSpacer'] = sketch.id
  spacerLabel.append(spacer)
  const selectedSnappedIds = (): string[] => [...snapped.selectedOptions].map(option => option.value)
  const updateFlowControls = (): void => {
    const count = selectedSnappedIds().length
    const availability = StudioSketchFlowControls.availability(
      count,
      onFlowAction !== undefined && !busy,
      snapState.sourceVersion !== undefined,
    )
    direction.disabled = availability.direction.disabled
    direction.title = availability.direction.reason
    separator.disabled = availability.separator.disabled
    separator.title = availability.separator.reason
    spacer.disabled = availability.spacer.disabled
    spacer.title = availability.spacer.reason
  }
  snapped.addEventListener('change', updateFlowControls)
  updateFlowControls()
  toolbar.append(snap, undo, snapped, unsnap, direction, separator, spacerLabel)
  const dropTarget = document.createElement('div')
  dropTarget.dataset['taoStudioSketchDropTarget'] = sketch.id
  dropTarget.textContent = 'Drop a moved rectangle here to Snap it into this running view'
  dropTarget.style.alignItems = 'center'
  dropTarget.style.border = '1px dashed currentColor'
  dropTarget.style.display = 'flex'
  dropTarget.style.justifyContent = 'center'
  dropTarget.style.minHeight = '44px'
  dropTarget.style.width = `${sketch.width}px`
  frame.append(name, board, dropTarget, toolbar)
  const gapIndicator = document.createElement('div')
  gapIndicator.dataset['taoStudioSketchGapIndicator'] = 'true'
  gapIndicator.textContent = 'Release over the running cell to Snap this rectangle into its flow'
  gapIndicator.hidden = true
  /** Pointer capture keeps events on the board; hit-test the visible sibling target underneath it. */
  const overOwnCell = (event: PointerEvent): boolean => {
    // The moved rectangle is the topmost element at the pointer. Inspect the whole hit-test stack so
    // the visible sibling target underneath the free-geometry overlay remains reachable.
    const targets = document.elementsFromPoint?.(event.clientX, event.clientY)
      ?? [document.elementFromPoint(event.clientX, event.clientY)].filter(candidate => candidate !== null)
    return StudioSketchDragTarget.ownsAny(targets, sketch.id)
  }
  const moveRelease = (event: PointerEvent): StudioSketchMoveRelease => ({
    duplicate: duplicateSourceId !== undefined,
    overCell: overOwnCell(event),
    point: point(event),
    size: { height: sketch.height, width: sketch.width },
  })
  const requestSnap = async (rectIds: readonly string[], confirmedProposalVersion?: string): Promise<void> => {
    if (onSnap === undefined || snapState.sourceVersion === undefined || rectIds.length === 0 || busy) {
      return
    }
    busy = true
    snap.disabled = true
    try {
      const checkpointId = snapState.pendingCheckpointId ?? crypto.randomUUID()
      const result = await onSnap({
        checkpointId,
        ...(confirmedProposalVersion === undefined ? {} : { confirmedProposalVersion }),
        rectIds,
        sketchId: sketch.id,
        sourceVersion: snapState.sourceVersion,
      })
      clearError()
      if ('catalog' in result) {
        snapState.pending = undefined
        snapState.pendingCheckpointId = undefined
        snapState.lastCheckpointId = result.checkpoint.id
        snapState.sourceVersion = result.file.sourceVersion
        undo.disabled = false
        renderAuthoritative(result.catalog.sketches, result.file.sourceVersion)
      } else {
        snapState.pending = result
        snapState.pendingCheckpointId = checkpointId
        paint()
      }
    } catch (error) {
      reportError(error)
    } finally {
      busy = false
      snap.disabled = false
    }
  }
  const requestFlow = async (action: StudioSketchFlowAction): Promise<void> => {
    if (onFlowAction === undefined || snapState.sourceVersion === undefined || busy) {
      return
    }
    busy = true
    updateFlowControls()
    try {
      const result = await onFlowAction({
        action,
        checkpointId: crypto.randomUUID(),
        sketchId: sketch.id,
        sourceVersion: snapState.sourceVersion,
      })
      clearError()
      snapState.lastCheckpointId = result.checkpoint.id
      snapState.sourceVersion = result.file.sourceVersion
      renderAuthoritative(result.catalog.sketches, result.file.sourceVersion)
    } catch (error) {
      reportError(error)
    } finally {
      busy = false
      updateFlowControls()
    }
  }
  direction.addEventListener('click', () => {
    const [rectId] = selectedSnappedIds()
    if (rectId !== undefined) {
      void requestFlow({ kind: 'toggle-direction', rectId })
    }
  })
  separator.addEventListener('click', () => {
    const [afterRectId, beforeRectId] = selectedSnappedIds()
    if (afterRectId !== undefined) {
      void requestFlow({
        afterRectId,
        ...(beforeRectId === undefined ? {} : { beforeRectId }),
        kind: 'insert-separator',
      })
    }
  })
  spacer.addEventListener('change', () => {
    const selected = selectedSnappedIds()
    const first = Number(spacer.value)
    const action = StudioSketchFlowControls.spacerAction(selected, first)
    if (action === undefined) {
      return
    }
    const second = 100 - first
    spacerLabel.firstChild!.textContent = `Spacer ratio ${first}:${second}`
    void requestFlow(action)
  })
  snap.disabled = onSnap === undefined || snapState.sourceVersion === undefined || sketch.rects.length === 0
  if (snapState.sourceVersion === undefined) {
    snap.title = 'Snap requires the generated view source version.'
  }
  snap.addEventListener('click', () => {
    const selectedIds = selection()?.sketchId === sketch.id
      ? selection()?.rectIds ?? new Set<string>()
      : new Set<string>()
    void requestSnap(StudioSketchSelection.rectIds(sketch, selectedIds))
  })
  undo.addEventListener('click', () => {
    if (
      snapState.lastCheckpointId === undefined
      || snapState.sourceVersion === undefined
      || onUndoSnap === undefined
      || busy
    ) {
      return
    }
    busy = true
    undo.disabled = true
    void onUndoSnap({ checkpointId: snapState.lastCheckpointId, sourceVersion: snapState.sourceVersion }).then(
      result => {
        clearError()
        snapState.lastCheckpointId = undefined
        snapState.sourceVersion = result.file.sourceVersion
        renderAuthoritative(result.catalog.sketches, result.file.sourceVersion)
      },
      error => {
        undo.disabled = false
        reportError(error)
      },
    ).finally(() => {
      busy = false
    })
  })
  unsnap.addEventListener('click', () => {
    if (onUnsnap === undefined || snapState.sourceVersion === undefined || busy) {
      return
    }
    const selected = [...snapped.selectedOptions].map(option => option.value)
    const rectIds = selected.length === 0 ? sketch.snapped.map(item => item.rect.id) : selected
    if (rectIds.length === 0) {
      return
    }
    busy = true
    unsnap.disabled = true
    void onUnsnap({
      checkpointId: crypto.randomUUID(),
      rectIds,
      sketchId: sketch.id,
      sourceVersion: snapState.sourceVersion,
    }).then(result => {
      clearError()
      snapState.lastCheckpointId = result.checkpoint.id
      snapState.sourceVersion = result.file.sourceVersion
      undo.disabled = false
      renderAuthoritative(result.catalog.sketches, result.file.sourceVersion)
    }, error => {
      unsnap.disabled = false
      reportError(error)
    }).finally(() => {
      busy = false
    })
  })
  const proposalElement = (): HTMLElement => {
    const proposal = snapState.pending!
    const overlay = document.createElement('section')
    overlay.dataset['taoStudioSketchSnapProposal'] = sketch.id
    const tree = document.createElement('pre')
    tree.dataset['taoStudioSketchSnapTree'] = 'true'
    tree.textContent = proposal.content
    const diff = document.createElement('pre')
    diff.dataset['taoStudioSketchSnapDiff'] = 'true'
    diff.textContent = proposal.diff
    const apply = document.createElement('button')
    apply.textContent = 'Apply'
    apply.addEventListener('click', () => {
      const confirmation = StudioSketchProposal.confirmation(proposal)
      void requestSnap(confirmation.rectIds, confirmation.confirmedProposalVersion)
    })
    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => {
      snapState.pending = StudioSketchProposal.cancel()
      snapState.pendingCheckpointId = undefined
      paint()
    })
    overlay.append(tree, diff, apply, cancel)
    return overlay
  }
  const point = (event: PointerEvent): StudioSketchPoint => relativePoint(board, event)
  const beginResize = (event: PointerEvent, handle: StudioSketchResizeHandle): void => {
    if (activePointer !== undefined || !primaryPointer(event)) {
      return
    }
    event.stopPropagation()
    state = StudioSketchGeometry.beginResize(state, handle, point(event))
    if (state.gesture === undefined) {
      return
    }
    capturePointer(event.pointerId)
    event.preventDefault()
  }
  board.addEventListener('pointerdown', event => {
    const target = event.target as HTMLElement | null
    const begins = StudioSketchBoardInput.beginsGesture({
      ...(activePointer === undefined ? {} : { activePointer }),
      inToolbar: toolbar.contains(target),
      onHandle: target?.dataset?.['taoStudioSketchHandle'] !== undefined,
      primary: primaryPointer(event),
    })
    if (!begins) {
      return
    }
    const location = point(event)
    const hit = StudioSketchGeometry.hit(state.rects, location)
    if (hit === undefined) {
      const id = crypto.randomUUID()
      state = StudioSketchGeometry.beginDraw(state, id, location)
      select({ rectId: id, rectIds: new Set([id]), sketchId: sketch.id })
    } else {
      state = { ...state, selectedId: hit.id }
      const selectedIds = selection()?.sketchId === sketch.id
        ? selection()?.rectIds ?? new Set<string>()
        : new Set<string>()
      const rectIds = StudioSketchSelection.toggle(selectedIds, hit.id, event.shiftKey)
      const selectedRectId = rectIds.has(hit.id) ? hit.id : rectIds.values().next().value
      select(selectedRectId === undefined ? undefined : { rectId: selectedRectId, rectIds, sketchId: sketch.id })
      if (event.shiftKey) {
        paint()
        return
      }
      const duplicateId = event.altKey ? crypto.randomUUID() : undefined
      duplicateSourceId = duplicateId === undefined ? undefined : hit.id
      state = StudioSketchGeometry.beginMove(state, location, { duplicateId, optionKey: event.altKey })
      select({ rectId: state.selectedId!, rectIds: new Set([state.selectedId!]), sketchId: sketch.id })
    }
    if (state.gesture === undefined) {
      return
    }
    capturePointer(event.pointerId)
    event.preventDefault()
    paint()
  })
  board.addEventListener('pointermove', event => {
    if (state.gesture === undefined || event.pointerId !== activePointer) {
      return
    }
    const moving = state.gesture.kind === 'move'
    state = StudioSketchGeometry.updatePointer(state, point(event))
    const landing = moving && StudioSketchDragOneIn.outcome(moveRelease(event)) === 'snap'
    gapIndicator.hidden = !landing
    if (landing) {
      gapIndicator.dataset['state'] = 'landing'
    } else {
      delete gapIndicator.dataset['state']
    }
    paint()
  })
  // The browser cancels a gesture outright, or silently takes the capture away when the board is
  // moved in the DOM or another element captures the pointer. Either way the pointerup never
  // arrives, so both end the gesture; otherwise the gesture lock would hold the render gate closed
  // until the next successful gesture.
  const cancelGesture = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) {
      return
    }
    state = StudioSketchGeometry.cancelPointer(state)
    duplicateSourceId = undefined
    paint()
    releasePointer(event.pointerId)
  }
  board.addEventListener('pointercancel', cancelGesture)
  board.addEventListener('lostpointercapture', cancelGesture)
  board.addEventListener('pointerup', event => {
    if (event.pointerId !== activePointer) {
      return
    }
    const gesture = state.gesture
    if (gesture === undefined) {
      releasePointer(event.pointerId)
      return
    }
    gapIndicator.hidden = true
    delete gapIndicator.dataset['state']
    if (gesture.kind === 'move' && StudioSketchDragOneIn.outcome(moveRelease(event)) === 'snap') {
      // Drag-one-in: the free geometry stays where it was and the rectangle joins the flow.
      state = StudioSketchGeometry.cancelPointer(state)
      duplicateSourceId = undefined
      paint()
      StudioSketchPointerRelease.afterCommit(
        () => requestSnap([gesture.id]),
        () => releasePointer(event.pointerId),
      )
      return
    }
    state = StudioSketchGeometry.endPointer(state, point(event))
    const rect = state.rects.find(candidate => candidate.id === state.selectedId)
    let change: StudioSketchRectChange | undefined
    if (rect !== undefined) {
      const kind = gesture.kind === 'draw'
        ? 'add'
        : gesture.kind === 'move' && gesture.beforeRects.length < state.rects.length
        ? 'duplicate'
        : 'update'
      if (kind !== 'update' || !StudioSketchChanges.equal(rect, gesture.original)) {
        change = {
          kind,
          rect,
          sketchId: sketch.id,
          ...(kind === 'duplicate' ? { sourceRectId: duplicateSourceId } : {}),
        }
      }
    }
    duplicateSourceId = undefined
    paint()
    StudioSketchPointerRelease.afterCommit(
      () => change === undefined ? undefined : onChange?.(change),
      () => releasePointer(event.pointerId),
    )
  })
  paint()
  return frame
}

function primaryPointer(event: PointerEvent): boolean {
  return event.button === 0 && event.isPrimary !== false
}

/**
 * A pointer offset in the element's own coordinates. `getBoundingClientRect` already reports the
 * canvas transform, so the offset it yields is in screen pixels and has to be divided by the zoom
 * to land where the person is actually pointing on the surface.
 */
function relativePoint(element: HTMLElement, event: PointerEvent): StudioSketchPoint {
  const bounds = element.getBoundingClientRect()
  const scale = canvasScale(element)
  return { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale }
}

function paintOuterPreview(
  workspace: HTMLElement,
  preview: Readonly<{ height: number; width: number; x: number; y: number }> | undefined,
): void {
  const existing = workspace.querySelector<HTMLElement>(':scope > [data-tao-studio-sketch-outer-preview]')
  if (preview === undefined) {
    existing?.remove()
    return
  }
  const document = workspace.ownerDocument
  const ghost = existing ?? document.createElement('div')
  ghost.dataset['taoStudioSketchOuterPreview'] = 'true'
  ghost.style.left = `${preview.x}px`
  ghost.style.top = `${preview.y}px`
  ghost.style.width = `${preview.width}px`
  ghost.style.height = `${preview.height}px`
  if (existing === null) {
    workspace.append(ghost)
  }
}

function rectElement(
  document: Document,
  rect: StudioSketchRect,
  selected: boolean,
  beginResize: (event: PointerEvent, handle: StudioSketchResizeHandle) => void,
): HTMLElement {
  const element = document.createElement('div')
  element.dataset['taoStudioSketchRect'] = rect.id
  element.dataset['taoStudioSketchRectKind'] = rect.kind
  element.style.height = `${rect.height}px`
  element.style.left = `${rect.x}px`
  element.style.position = 'absolute'
  element.style.top = `${rect.y}px`
  element.style.width = `${rect.width}px`
  element.textContent = rect.content ?? rect.kind
  if (selected) {
    element.dataset['selected'] = 'true'
    for (const handle of handles) {
      const control = document.createElement('button')
      control.ariaLabel = `Resize ${handle}`
      control.dataset['taoStudioSketchHandle'] = handle
      control.addEventListener('pointerdown', event => beginResize(event, handle))
      element.append(control)
    }
  }
  return element
}

function renderInspector(
  inspector: HTMLElement,
  sketches: readonly StudioSketch[],
  selected: Readonly<{ rectId: string; rectIds: ReadonlySet<string>; sketchId: string }> | undefined,
  update: (change: StudioSketchRectChange) => void,
): void {
  const document = inspector.ownerDocument
  const sketch = sketches.find(candidate => candidate.id === selected?.sketchId)
  const rect = sketch?.rects.find(candidate => candidate.id === selected?.rectId)
  inspector.hidden = rect === undefined
  if (sketch === undefined || rect === undefined) {
    inspector.replaceChildren()
    return
  }
  const kind = document.createElement('select')
  kind.ariaLabel = 'Rectangle kind'
  for (const value of ['Placeholder', 'Text', 'Image', 'Box']) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    option.selected = value === rect.kind
    kind.add(option)
  }
  kind.addEventListener(
    'change',
    () => update({ kind: 'update', rect: { ...rect, kind: kind.value }, sketchId: sketch.id }),
  )
  const content = document.createElement('input')
  content.ariaLabel = 'Rectangle text'
  content.value = rect.content ?? ''
  content.addEventListener(
    'change',
    () => update({ kind: 'update', rect: { ...rect, content: content.value }, sketchId: sketch.id }),
  )
  inspector.replaceChildren(kind, content)
}
