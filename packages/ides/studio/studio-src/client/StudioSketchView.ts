import type {
  StudioSketchFlowAction,
  StudioSketchSnapApplyResult,
  StudioSketchSnapProposalResult,
  StudioSketchSnapUndoResult,
} from '../StudioProjectSession'
import type { StudioSketch, StudioSketchRect } from '../StudioSketchCatalog'
import { canvasScale, isStudioTypingTarget } from './matrix/StudioCanvasViewport'
import { studioDrawLiveHeight } from './matrix/StudioDrawLiveCells'
import { type StudioFeedDrop, StudioFeedTransfer } from './StudioFeedController'
import type { StudioFeedExampleValues, StudioFeedSample } from './StudioFeedSamples'
import { StudioSketchBadge, type StudioSketchConvertIntent } from './StudioSketchBadge'
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
  /**
   * confirmRemove asks the person before a removal that deletes a file, answering whether to go on.
   * Without it such a removal does not happen.
   */
  confirmRemove?: (question: string) => Promise<boolean>
  /** onConvert switches a root rectangle's badge and answers with the catalog's sketches afterwards. */
  onConvert?: (intent: StudioSketchConvertIntent) => Promise<readonly StudioSketch[]>
  onCreateSketch?: (input: Readonly<{ height: number; width: number; x: number; y: number }>) => Promise<void> | void
  /** onDeleteRects deletes free rectangles from one sketch and answers with the catalog's sketches afterwards. */
  onDeleteRects?: (sketchId: string, rectIds: readonly string[]) => Promise<readonly StudioSketch[]>
  /** dropInto lets a whole frame be dragged onto another view's running cell to render its view there. */
  dropInto?: StudioSketchDropInto
  onFeedDrop?: (payload: StudioFeedDrop, sketchId: string, rectId?: string) => Promise<void>
  onError?: (error: unknown) => void
  onFlowAction?: (request: StudioSketchViewFlowActionRequest) => Promise<StudioSketchSnapApplyResult>
  /** onMove places a root rectangle at a new canvas origin and answers with the catalog's sketches afterwards. */
  onMove?: (move: StudioSketchFrameMove) => Promise<readonly StudioSketch[]>
  onRectChange?: (
    change: StudioSketchRectChange,
  ) => Promise<readonly StudioSketch[] | void> | readonly StudioSketch[] | void
  /**
   * onRemove takes a root rectangle off the canvas and answers with the catalog's sketches afterwards.
   * A source-backed card leaves the catalog only; a drawn definition also deletes its generated file.
   */
  onRemove?: (sketchId: string) => Promise<readonly StudioSketch[]>
  onSnap?: (
    request: StudioSketchViewSnapRequest,
  ) => Promise<StudioSketchSnapApplyResult | StudioSketchSnapProposalResult>
  onUnsnap?: (request: StudioSketchViewUnsnapRequest) => Promise<StudioSketchSnapApplyResult>
  onUndoSnap?: (request: StudioSketchViewUndoRequest) => Promise<StudioSketchSnapUndoResult>
  /** renderableViews lists the views a render rectangle can start from, read when a badge menu opens. */
  renderableViews?: () => readonly string[]
  sketches: readonly StudioSketch[]
  exampleValues?: StudioFeedExampleValues
  sourceVersion?: string
  sourceVersions?: Readonly<Record<string, string>>
}>

/** Viewport coordinates, as a pointer event reports them. */
type StudioSketchClientPoint = Readonly<{ x: number; y: number }>

/**
 * Where a dragged frame can land besides the canvas: `target` names the running cell under the point
 * that would take it, if any, which the frame carries while it hovers, and `drop` renders the frame's
 * view into that cell's view.
 */
export type StudioSketchDropInto = Readonly<{
  drop: (point: StudioSketchClientPoint, sketch: StudioSketch) => Promise<void>
  target: (point: StudioSketchClientPoint, sketch: StudioSketch) => string | undefined
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
  /** contextMenu is a Control-click, which opens the rectangle's menu instead of drawing. */
  contextMenu?: boolean
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
    return pointer.activePointer === undefined && pointer.primary && pointer.contextMenu !== true
      && !pointer.inToolbar && !pointer.onHandle
  },
} as const

export type StudioSketchTool = 'rect' | 'select' | 'text'

type StudioSketchBox = Readonly<{ height: number; width: number; x: number; y: number }>

/**
 * StudioSketchTools is the Draw canvas's one tool strip (decisions B and G). V selects: a press on a
 * rectangle picks it up, and a drag across empty sketch space draws a marquee. R draws a frame on
 * empty canvas and a rectangle inside a sketch; T draws a Text rectangle inside a sketch. A drawing
 * tool is used once and hands back to V, as in Figma.
 */
export const StudioSketchTools = {
  all: [
    { key: 'v', label: 'Select', tool: 'select' },
    { key: 'r', label: 'Rectangle', tool: 'rect' },
    { key: 't', label: 'Text', tool: 'text' },
  ] as const satisfies readonly Readonly<{ key: string; label: string; tool: StudioSketchTool }>[],
  initial: 'select' as StudioSketchTool,
  afterDraw(): StudioSketchTool {
    return 'select'
  },
  /** boardPress says what a press inside a sketch begins; a drawing tool draws even over a rectangle. */
  boardPress(tool: StudioSketchTool, onRect: boolean): 'draw' | 'marquee' | 'pick' {
    return tool !== 'select' ? 'draw' : onRect ? 'pick' : 'marquee'
  },
  /** canvasPress says what a press on empty canvas, outside every sketch, begins. */
  canvasPress(tool: StudioSketchTool): 'clear' | 'draw-frame' | 'none' {
    return tool === 'rect' ? 'draw-frame' : tool === 'select' ? 'clear' : 'none'
  },
  drawKind(tool: StudioSketchTool): 'Placeholder' | 'Text' {
    return tool === 'text' ? 'Text' : 'Placeholder'
  },
  fromKey(key: string): StudioSketchTool | undefined {
    return StudioSketchTools.all.find(entry => entry.key === key)?.tool
  },
} as const

/** A marquee that travels less than this many pixels on both axes was a click on the frame. */
const marqueeClickExtent = 3

/** StudioSketchMarquee picks the free rectangles a V drag across empty sketch space touches. */
export const StudioSketchMarquee = {
  box(origin: StudioSketchPoint, point: StudioSketchPoint): StudioSketchBox {
    return rectFromPoints(origin, point)
  },
  click(box: StudioSketchBox): boolean {
    return box.width < marqueeClickExtent && box.height < marqueeClickExtent
  },
  /** pick answers the rectangles overlapping the box, added to the earlier selection when Shift is held. */
  pick(
    rects: readonly StudioSketchRect[],
    box: StudioSketchBox,
    before: ReadonlySet<string>,
    additive: boolean,
  ): ReadonlySet<string> {
    const touched = rects.filter(rect =>
      rect.x < box.x + box.width && rect.x + rect.width > box.x && rect.y < box.y + box.height
      && rect.y + rect.height > box.y
    ).map(rect => rect.id)
    return new Set([...(additive ? before : []), ...touched])
  },
} as const

export type StudioSketchKeyCommand =
  | 'clear'
  | 'delete-rects'
  | 'none'
  | 'remove-frame'
  | 'tool-rect'
  | 'tool-select'
  | 'tool-text'

export type StudioSketchKeyInput = Readonly<{
  composing: boolean
  frameSelected: boolean
  key: string
  modified: boolean
  selectedRects: number
  tool?: StudioSketchTool
  typing: boolean
}>

/**
 * StudioSketchKeys routes a key pressed while the Draw canvas has the person's attention. Delete or
 * Backspace deletes the selected free rectangles when there are any and otherwise removes the selected
 * rectangle frame. V, R, and T pick a tool. Escape first puts a drawing tool back to V, then clears
 * the selection. Keys typed into a field, or held with a modifier, are never the canvas's.
 */
export const StudioSketchKeys = {
  command(input: StudioSketchKeyInput): StudioSketchKeyCommand {
    if (input.typing || input.composing || input.modified) {
      return 'none'
    }
    const tool = StudioSketchTools.fromKey(input.key)
    if (tool !== undefined) {
      return `tool-${tool}`
    }
    if (input.key === 'Escape') {
      return input.tool !== undefined && input.tool !== 'select'
        ? 'tool-select'
        : input.selectedRects > 0 || input.frameSelected
        ? 'clear'
        : 'none'
    }
    if (input.key !== 'Delete' && input.key !== 'Backspace') {
      return 'none'
    }
    return input.selectedRects > 0 ? 'delete-rects' : input.frameSelected ? 'remove-frame' : 'none'
  },
  /** routes says whether a key can mean anything to the canvas, before its target is inspected. */
  routes(key: string): boolean {
    return key === 'Delete' || key === 'Backspace' || key === 'Escape'
      || StudioSketchTools.fromKey(key) !== undefined
  },
} as const

type StudioSketchFrameMove = Readonly<{ sketchId: string; x: number; y: number }>

export type StudioSketchFrameDragState = Readonly<{
  moved: boolean
  origin: StudioSketchPoint
  pointerId: number
  scale: number
  start: StudioSketchPoint
}>

/** A press on a frame's header that travels less than this many screen pixels is a click, not a drag. */
const frameDragThreshold = 3

/**
 * StudioSketchFrameDrag follows a root rectangle dragged by its header. The pointer travels in screen
 * pixels and the canvas may be zoomed, so the offset is divided by the zoom; the origin stays on the
 * canvas's nonnegative quadrant and on whole pixels, as the catalog stores it.
 */
export const StudioSketchFrameDrag = {
  begin(
    pointerId: number,
    origin: StudioSketchPoint,
    start: StudioSketchPoint,
    scale: number,
  ): StudioSketchFrameDragState {
    return { moved: false, origin, pointerId, scale: scale > 0 ? scale : 1, start }
  },
  update(
    drag: StudioSketchFrameDragState,
    client: StudioSketchPoint,
  ): Readonly<{ drag: StudioSketchFrameDragState; x: number; y: number }> {
    const dx = client.x - drag.start.x
    const dy = client.y - drag.start.y
    return {
      drag: drag.moved || Math.hypot(dx, dy) >= frameDragThreshold ? { ...drag, moved: true } : drag,
      x: Math.max(0, Math.round(drag.origin.x + dx / drag.scale)),
      y: Math.max(0, Math.round(drag.origin.y + dy / drag.scale)),
    }
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
  render(
    sketches: readonly StudioSketch[],
    sourceVersions?: Readonly<Record<string, string>>,
    exampleValues?: StudioFeedExampleValues,
  ): void
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
    let exampleValues = options.exampleValues ?? {}
    let currentSourceVersion = options.sourceVersion
    let viewSourceVersions: Record<string, string> = { ...options.sourceVersions }
    const snapStates = new Map<string, StudioSketchSnapUiState>()
    let selected: Readonly<{ rectId: string; rectIds: ReadonlySet<string>; sketchId: string }> | undefined
    /** The root rectangle selected as a whole; never at the same time as rectangles inside one. */
    let selectedFrame: string | undefined
    /** Whether the person's last press landed on the Draw canvas, which is when its keys are the canvas's. */
    let canvasActive = false
    const frames = new Map<string, HTMLElement>()
    const removing = new Set<string>()
    let deletingRects = false
    let frameDrag:
      | Readonly<{ frame: HTMLElement; name: HTMLElement; sketch: StudioSketch; state: StudioSketchFrameDragState }>
      | undefined
    let outerGesture: StudioSketchOuterGesture | undefined
    let disposed = false
    let inlineEdit: {
      cancel(): void
      invalidated: boolean
      pending: boolean
      rect: StudioSketchRect
      sketchId: string
    } | undefined
    let tool = StudioSketchTools.initial
    // The strip sits beside the Draw canvas rather than on it, so it neither pans nor zooms.
    const strip = document.createElement('nav')
    strip.className = 'studio-draw-tools'
    strip.dataset['taoStudioDrawTools'] = 'true'
    strip.setAttribute('aria-label', 'Draw tools')
    const toolButtons = StudioSketchTools.all.map(entry => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset['taoStudioDrawTool'] = entry.tool
      button.textContent = entry.key.toUpperCase()
      button.title = `${entry.label} (${entry.key.toUpperCase()})`
      button.setAttribute('aria-label', entry.label)
      button.addEventListener('click', () => setTool(entry.tool))
      return button
    })
    strip.append(...toolButtons)
    const setTool = (next: StudioSketchTool): void => {
      tool = next
      workspace.dataset['taoStudioSketchTool'] = next
      for (const button of toolButtons) {
        button.setAttribute('aria-pressed', String(button.dataset['taoStudioDrawTool'] === next))
      }
    }
    setTool(tool)
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
      sketches = StudioSketchChanges.settle(gate.deferred?.sketches ?? sketches, change)
      selected = { rectId: change.rect.id, rectIds: new Set([change.rect.id]), sketchId: change.sketchId }
      render(sketches)
    }
    const commit = (
      change: StudioSketchRectChange,
      current: () => boolean = () => true,
    ): Promise<void> | void => {
      const settle = (authoritative: readonly StudioSketch[] | void): void => {
        if (disposed || !current()) {
          return
        }
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
            render(gate.deferred?.sketches ?? sketches)
          })
        } else {
          settle(result)
        }
      } catch (error) {
        options.onError?.(error)
        render(gate.deferred?.sketches ?? sketches)
      }
    }

    const render = (
      nextSketches: readonly StudioSketch[],
      nextSourceVersions?: Readonly<Record<string, string>>,
      nextExamples?: StudioFeedExampleValues,
    ): void => {
      exampleValues = nextExamples ?? exampleValues
      if (disposed) {
        return
      }
      if (nextSourceVersions !== undefined) {
        viewSourceVersions = { ...viewSourceVersions, ...nextSourceVersions }
      }
      const decision = StudioSketchRenderGate.request(gate, nextSketches, currentSourceVersion)
      gate = decision.state
      if (decision.render) {
        renderNow(nextSketches)
      }
    }
    const receive = (
      nextSketches: readonly StudioSketch[],
      nextSourceVersions?: Readonly<Record<string, string>>,
      nextExamples?: StudioFeedExampleValues,
    ): void => {
      const edit = inlineEdit
      const rect = nextSketches.find(sketch => sketch.id === edit?.sketchId)?.rects.find(candidate =>
        candidate.id === edit?.rect.id
      )
      render(nextSketches, nextSourceVersions, nextExamples)
      if (edit !== undefined && (rect === undefined || !StudioSketchChanges.equal(rect, edit.rect))) {
        edit.invalidated = true
        if (!edit.pending) {
          edit.cancel()
        }
      }
    }
    const editText = (sketchId: string, rect: StudioSketchRect, element: HTMLElement): void => {
      if (disposed || inlineEdit !== undefined || rect.kind !== 'Text') {
        return
      }
      const input = document.createElement('textarea')
      input.ariaLabel = 'Rectangle text'
      input.dataset['taoStudioSketchTextEditor'] = rect.id
      input.value = rect.content ?? ''
      input.style.boxSizing = 'border-box'
      input.style.height = '100%'
      input.style.resize = 'none'
      input.style.width = '100%'
      const edit = {
        cancel: (): void => {
          if (inlineEdit !== edit) {
            return
          }
          inlineEdit = undefined
          render(gate.deferred?.sketches ?? sketches)
          gestureLock.end()
        },
        invalidated: false,
        pending: false,
        rect,
        sketchId,
      }
      inlineEdit = edit
      gestureLock.begin()
      selected = { rectId: rect.id, rectIds: new Set([rect.id]), sketchId }
      element.replaceChildren(input)
      for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick']) {
        input.addEventListener(type, event => event.stopPropagation())
      }
      input.addEventListener('keydown', event => {
        event.stopPropagation()
        if (inlineEdit !== edit || edit.pending || event.isComposing) {
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          edit.cancel()
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          if (input.value === (rect.content ?? '')) {
            edit.cancel()
            return
          }
          edit.pending = true
          input.disabled = true
          StudioSketchPointerRelease.afterCommit(
            () =>
              commit(
                { kind: 'update', rect: { ...rect, content: input.value }, sketchId },
                () => inlineEdit === edit && !edit.invalidated,
              ),
            edit.cancel,
          )
        }
      })
      input.addEventListener('blur', () => {
        if (!edit.pending) {
          edit.cancel()
        }
      })
      input.focus()
      input.select()
    }
    const convert = (intent: StudioSketchConvertIntent): void => {
      const pending = options.onConvert?.(intent)
      void pending?.then(next => receive(next), error => options.onError?.(error))
    }
    /** Removing a drawn definition deletes its generated file, so it waits for the person to agree. */
    const remove = (sketchId: string): void => {
      const sketch = sketches.find(candidate => candidate.id === sketchId)
      const onRemove = options.onRemove
      if (disposed || sketch === undefined || onRemove === undefined || removing.has(sketchId)) {
        return
      }
      removing.add(sketchId)
      const question = StudioSketchBadge.removalQuestion(sketch)
      const confirmed = question === undefined
        ? Promise.resolve(true)
        : options.confirmRemove?.(question) ?? Promise.resolve(false)
      void confirmed.then(async agreed => {
        if (!agreed || disposed) {
          return
        }
        const next = await onRemove(sketchId)
        if (selectedFrame === sketchId) {
          selectedFrame = undefined
        }
        receive(next)
      }).catch(error => options.onError?.(error)).finally(() => removing.delete(sketchId))
    }
    const paintFrames = (): void => {
      for (const [id, frame] of frames) {
        if (id === selectedFrame) {
          frame.dataset['selected'] = 'true'
        } else {
          delete frame.dataset['selected']
        }
      }
    }
    const selectFrame = (sketchId: string): void => {
      const hadRects = selected !== undefined
      selected = undefined
      selectedFrame = sketchId
      if (hadRects) {
        render(gate.deferred?.sketches ?? sketches)
      } else {
        paintFrames()
      }
      renderInspector(inspector, sketches, selected, commit)
    }
    const clearSelection = (): void => {
      selected = undefined
      selectedFrame = undefined
      render(gate.deferred?.sketches ?? sketches)
    }
    const boardTools: StudioSketchBoardTools = {
      current: () => tool,
      handBack: () => setTool(StudioSketchTools.afterDraw()),
      // A drawn Text rectangle opens for typing once its commit has settled and the board re-rendered.
      drawn: (sketchId, rectId) => {
        const rect = sketches.find(sketch => sketch.id === sketchId)?.rects.find(candidate => candidate.id === rectId)
        const element = [...frames.get(sketchId)?.querySelectorAll<HTMLElement>('[data-tao-studio-sketch-rect]') ?? []]
          .find(candidate => candidate.dataset['taoStudioSketchRect'] === rectId)
        if (rect?.kind === 'Text' && element !== undefined) {
          editText(sketchId, rect, element)
        }
      },
    }
    const selectedFreeRects = (): Readonly<{ rectIds: readonly string[]; sketchId: string }> | undefined => {
      const sketch = sketches.find(candidate => candidate.id === selected?.sketchId)
      if (sketch === undefined || selected === undefined) {
        return undefined
      }
      const rectIds = [...StudioSketchSelection.settle(sketch, selected.rectIds)]
      return rectIds.length === 0 ? undefined : { rectIds, sketchId: sketch.id }
    }
    const deleteRects = (target: Readonly<{ rectIds: readonly string[]; sketchId: string }>): void => {
      const onDeleteRects = options.onDeleteRects
      if (onDeleteRects === undefined || deletingRects) {
        return
      }
      deletingRects = true
      void onDeleteRects(target.sketchId, target.rectIds).then(next => {
        selected = undefined
        receive(next)
      }, error => {
        options.onError?.(error)
        render(gate.deferred?.sketches ?? sketches)
      }).finally(() => {
        deletingRects = false
      })
    }
    const endFrameDrag = (drag: NonNullable<typeof frameDrag>): void => {
      try {
        drag.name.releasePointerCapture?.(drag.state.pointerId)
      } catch {
        // The capture was already gone.
      }
      delete drag.frame.dataset['taoStudioSketchMoving']
      delete drag.frame.dataset['taoStudioSketchDropInto']
      gestureLock.end()
    }
    /** The view a frame released at this point would be rendered into, when it is over another's running cell. */
    const dropIntoTarget = (sketch: StudioSketch, event: PointerEvent): string | undefined =>
      options.dropInto?.target({ x: event.clientX, y: event.clientY }, sketch)
    /**
     * attachFrame makes a root rectangle selectable and movable as a whole: its header selects it and
     * drags it, a card's body selects it, and a right-click or Control-click anywhere on it opens its menu.
     */
    const attachFrame = (frame: HTMLElement, sketch: StudioSketch): void => {
      frame.addEventListener('contextmenu', event => {
        event.preventDefault()
        event.stopPropagation()
        if (disposed || inlineEdit !== undefined || frameDrag !== undefined) {
          return
        }
        const at = relativePoint(frame, event)
        selectFrame(sketch.id)
        StudioSketchBadge.contextMenu(document, frames.get(sketch.id) ?? frame, sketch, at, remove)
      })
      const cardBody = frame.querySelector<HTMLElement>(':scope > [data-tao-studio-sketch-card-body]')
      cardBody?.addEventListener('pointerdown', event => {
        if (!disposed && primaryPointer(event) && !event.ctrlKey) {
          selectFrame(sketch.id)
        }
      })
      const name = frame.querySelector<HTMLElement>(':scope > [data-tao-studio-sketch-name]')
      if (name === null) {
        return
      }
      name.addEventListener('pointerdown', event => {
        if (
          disposed || inlineEdit !== undefined || frameDrag !== undefined || !primaryPointer(event) || event.ctrlKey
        ) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        frameDrag = {
          frame,
          name,
          sketch,
          state: StudioSketchFrameDrag.begin(
            event.pointerId,
            { x: sketch.x, y: sketch.y },
            { x: event.clientX, y: event.clientY },
            canvasScale(frame),
          ),
        }
        name.setPointerCapture?.(event.pointerId)
        frame.dataset['taoStudioSketchMoving'] = 'true'
        gestureLock.begin()
      })
      name.addEventListener('pointermove', event => {
        if (frameDrag?.name !== name || event.pointerId !== frameDrag.state.pointerId) {
          return
        }
        const next = StudioSketchFrameDrag.update(frameDrag.state, { x: event.clientX, y: event.clientY })
        frameDrag = { ...frameDrag, state: next.drag }
        if (next.drag.moved) {
          frame.style.left = `${next.x}px`
          frame.style.top = `${next.y}px`
          const into = dropIntoTarget(sketch, event)
          if (into === undefined) {
            delete frame.dataset['taoStudioSketchDropInto']
          } else {
            frame.dataset['taoStudioSketchDropInto'] = into
          }
        }
      })
      name.addEventListener('pointerup', event => {
        const drag = frameDrag
        if (drag?.name !== name || event.pointerId !== drag.state.pointerId) {
          return
        }
        frameDrag = undefined
        const next = StudioSketchFrameDrag.update(drag.state, { x: event.clientX, y: event.clientY })
        selectFrame(sketch.id)
        if (!next.drag.moved || (next.x === sketch.x && next.y === sketch.y)) {
          frame.style.left = `${sketch.x}px`
          frame.style.top = `${sketch.y}px`
          endFrameDrag(drag)
          return
        }
        // Released over another view's running cell, the frame renders there and stays where it was.
        if (options.dropInto !== undefined && dropIntoTarget(sketch, event) !== undefined) {
          frame.style.left = `${sketch.x}px`
          frame.style.top = `${sketch.y}px`
          endFrameDrag(drag)
          void options.dropInto.drop({ x: event.clientX, y: event.clientY }, sketch).catch(error =>
            options.onError?.(error)
          )
          return
        }
        frame.style.left = `${next.x}px`
        frame.style.top = `${next.y}px`
        // The frame stays where it was dropped until the catalog answers; a refusal puts it back.
        const onMove = options.onMove
        StudioSketchPointerRelease.afterCommit(
          () =>
            onMove === undefined
              ? render(gate.deferred?.sketches ?? sketches)
              : onMove({ sketchId: sketch.id, x: next.x, y: next.y }).then(moved => receive(moved), error => {
                options.onError?.(error)
                render(gate.deferred?.sketches ?? sketches)
              }),
          () => endFrameDrag(drag),
        )
      })
      const cancelFrameDrag = (event: PointerEvent): void => {
        const drag = frameDrag
        if (drag?.name !== name || event.pointerId !== drag.state.pointerId) {
          return
        }
        frameDrag = undefined
        frame.style.left = `${sketch.x}px`
        frame.style.top = `${sketch.y}px`
        endFrameDrag(drag)
      }
      name.addEventListener('pointercancel', cancelFrameDrag)
      name.addEventListener('lostpointercapture', cancelFrameDrag)
    }
    const onDocumentPointerDown = (event: Event): void => {
      const target = event.target as Node | null
      canvasActive = workspace.contains(target) || strip.contains(target)
    }
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (disposed || !canvasActive || gate.activeGestures > 0 || !StudioSketchKeys.routes(event.key)) {
        return
      }
      const rects = selectedFreeRects()
      const command = StudioSketchKeys.command({
        composing: event.isComposing === true,
        frameSelected: selectedFrame !== undefined,
        key: event.key,
        modified: event.metaKey === true || event.ctrlKey === true || event.altKey === true,
        selectedRects: rects?.rectIds.length ?? 0,
        tool,
        typing: isStudioTypingTarget(event.target),
      })
      if (command === 'none') {
        return
      }
      event.preventDefault()
      if (command === 'tool-rect' || command === 'tool-select' || command === 'tool-text') {
        setTool(command === 'tool-rect' ? 'rect' : command === 'tool-text' ? 'text' : 'select')
      } else if (command === 'clear') {
        clearSelection()
      } else if (command === 'delete-rects' && rects !== undefined) {
        deleteRects(rects)
      } else if (command === 'remove-frame' && selectedFrame !== undefined) {
        remove(selectedFrame)
      }
    }
    const renderNow = (nextSketches: readonly StudioSketch[], nextSourceVersion?: string): void => {
      if (disposed) {
        return
      }
      sketches = nextSketches
      currentSourceVersion = nextSourceVersion ?? currentSourceVersion
      if (selected !== undefined) {
        const sketch = sketches.find(candidate => candidate.id === selected?.sketchId)
        if (sketch !== undefined) {
          const rectIds = StudioSketchSelection.settle(sketch, selected.rectIds)
          selected = rectIds.size === 0 ? undefined : { ...selected, rectIds }
        }
      }
      if (!sketches.some(sketch => sketch.id === selectedFrame)) {
        selectedFrame = undefined
      }
      frames.clear()
      const boards = sketches.map(sketch => {
        const frame = renderFrame(sketch)
        frames.set(sketch.id, frame)
        attachFrame(frame, sketch)
        return frame
      })
      workspace.replaceChildren(...boards, inspector)
      paintFrames()
      renderInspector(inspector, sketches, selected, commit)
    }
    const renderFrame = (sketch: StudioSketch): HTMLElement => {
      {
        const badge = StudioSketchBadge.element(
          document,
          sketch,
          options.renderableViews ?? (() => []),
          convert,
          remove,
        )
        if (StudioSketchBadge.sourceBacked(sketch)) {
          return StudioSketchBadge.card(document, sketch, badge)
        }
        const frame = renderSketch(
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
            if (value !== undefined && selectedFrame !== undefined) {
              selectedFrame = undefined
              paintFrames()
            }
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
            receive(authoritative)
          },
          gestureLock,
          editText,
          () => inlineEdit !== undefined || disposed,
          options.onError,
          options.onFeedDrop,
          exampleValues[sketch.id],
          () => selectFrame(sketch.id),
          boardTools,
        )
        frame.querySelector(`:scope > [data-tao-studio-sketch-name]`)?.append(badge)
        return frame
      }
    }
    // The document hears a press first and forgets the canvas when it landed elsewhere; the workspace,
    // which sits inside it, claims the press again when it landed on the canvas.
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeyDown, true)
    workspace.addEventListener('pointerdown', () => {
      canvasActive = true
    }, true)
    workspace.addEventListener('pointerdown', event => {
      if (
        disposed || inlineEdit !== undefined || event.target !== workspace || outerGesture !== undefined
        || !primaryPointer(event)
      ) {
        return
      }
      const press = StudioSketchTools.canvasPress(tool)
      if (press === 'clear' && (selected !== undefined || selectedFrame !== undefined)) {
        clearSelection()
      }
      if (press !== 'draw-frame') {
        return
      }
      if (selectedFrame !== undefined) {
        selectedFrame = undefined
        paintFrames()
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
      setTool(StudioSketchTools.afterDraw())
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
    const stripHost = host.parentElement ?? host
    stripHost.append(strip)
    render(sketches)
    return {
      dispose() {
        disposed = true
        inlineEdit?.cancel()
        document.removeEventListener('pointerdown', onDocumentPointerDown, true)
        document.removeEventListener('keydown', onDocumentKeyDown, true)
        workspace.remove()
        strip.remove()
      },
      render: receive,
    }
  },
} as const

type StudioSketchGestureLock = Readonly<{
  begin(): void
  end(): void
}>

/** The canvas's active tool as a board reads it, the hand-back when a draw is released, and its settled commit. */
type StudioSketchBoardTools = Readonly<{
  current(): StudioSketchTool
  drawn(sketchId: string, rectId: string): void
  handBack(): void
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
  editText: (sketchId: string, rect: StudioSketchRect, element: HTMLElement) => void,
  editingText: () => boolean,
  onError: StudioSketchViewOptions['onError'],
  onFeedDrop: StudioSketchViewOptions['onFeedDrop'],
  exampleValues: Readonly<Record<string, StudioFeedSample>> | undefined,
  selectFrame: () => void,
  tools: StudioSketchBoardTools,
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
  let marquee:
    | Readonly<{ additive: boolean; before: ReadonlySet<string>; origin: StudioSketchPoint }>
    | undefined
  let busy = false
  /** A failure is shown on the board and reported to the host, which outlives a re-rendered board. */
  const reportError = (error: unknown): void => {
    board.dataset['taoStudioSketchError'] = error instanceof Error ? error.message : String(error)
    onError?.(error)
  }
  board.addEventListener('dragover', event => {
    if (onFeedDrop !== undefined && event.dataTransfer?.types.includes(StudioFeedTransfer.mime)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  })
  board.addEventListener('drop', event => {
    if (onFeedDrop === undefined || !event.dataTransfer?.types.includes(StudioFeedTransfer.mime)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    try {
      const payload = StudioFeedTransfer.parse(event.dataTransfer.getData(StudioFeedTransfer.mime))
      const target = event.target as HTMLElement | null
      const rectId = target?.closest<HTMLElement>('[data-tao-studio-sketch-rect]')?.dataset['taoStudioSketchRect']
      void onFeedDrop(payload, sketch.id, rectId).catch(reportError)
    } catch (error) {
      reportError(error)
    }
  })
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
  const rectElements = new Map<string, HTMLElement>()
  const paint = (): void => {
    if (editingText()) {
      return
    }
    const selectedIds = selection()?.sketchId === sketch.id
      ? selection()?.rectIds ?? new Set<string>()
      : new Set<string>()
    if (!board.contains(gapIndicator)) {
      board.append(gapIndicator)
    }
    for (const [id, element] of rectElements) {
      if (!state.rects.some(rect => rect.id === id)) {
        element.remove()
        rectElements.delete(id)
      }
    }
    for (const rect of state.rects) {
      const existing = rectElements.get(rect.id)
      const element = rectElement(
        document,
        rect,
        selectedIds.has(rect.id),
        beginResize,
        existing,
        exampleValues?.[rect.id],
      )
      if (existing === undefined) {
        rectElements.set(rect.id, element)
        board.append(element)
      }
    }
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
  // In Draw the view's running cell is laid over this slot, which grows to the cell's height. The
  // cell runs at the frame's own size, so the view lays out in the space it was drawn in.
  dropTarget.dataset['taoStudioDrawLiveSlot'] = sketch.view
  dropTarget.dataset['taoStudioDrawLiveWidth'] = String(sketch.width)
  dropTarget.dataset['taoStudioDrawLiveHeight'] = String(sketch.height)
  dropTarget.style.minHeight = `max(44px, var(${studioDrawLiveHeight}, 0px))`
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
    return StudioSketchDragTarget.ownsAny(targets, sketch.id) || overLiveSlot(event)
  }
  /** In Draw a filled slot lets pointers through to the boards around it, so hit testing cannot see it. */
  const overLiveSlot = (event: PointerEvent): boolean => {
    if (dropTarget.dataset['taoStudioDrawLiveFilled'] === undefined) {
      return false
    }
    const rect = dropTarget.getBoundingClientRect()
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top
      && event.clientY <= rect.bottom
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
    if (editingText() || activePointer !== undefined || !primaryPointer(event)) {
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
    if (editingText()) {
      return
    }
    const target = event.target as HTMLElement | null
    const begins = StudioSketchBoardInput.beginsGesture({
      ...(activePointer === undefined ? {} : { activePointer }),
      contextMenu: event.ctrlKey,
      inToolbar: toolbar.contains(target),
      onHandle: target?.dataset?.['taoStudioSketchHandle'] !== undefined,
      primary: primaryPointer(event),
    })
    if (!begins) {
      return
    }
    const location = point(event)
    const hit = StudioSketchGeometry.hit(state.rects, location)
    const press = StudioSketchTools.boardPress(tools.current(), hit !== undefined)
    if (press === 'marquee') {
      const current = selection()
      marquee = {
        additive: event.shiftKey,
        before: current?.sketchId === sketch.id ? current.rectIds : new Set(),
        origin: location,
      }
      capturePointer(event.pointerId)
      board.dataset['taoStudioSketchGesture'] = 'marquee'
      event.preventDefault()
      return
    }
    if (press === 'draw') {
      const id = crypto.randomUUID()
      state = StudioSketchGeometry.beginDraw(state, id, location, { kind: StudioSketchTools.drawKind(tools.current()) })
      select({ rectId: id, rectIds: new Set([id]), sketchId: sketch.id })
    } else if (hit !== undefined) {
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
  board.addEventListener('dblclick', event => {
    if (editingText() || activePointer !== undefined || event.button !== 0) {
      return
    }
    const rect = StudioSketchGeometry.hit(state.rects, relativePoint(board, event))
    const element = rect === undefined ? undefined : rectElements.get(rect.id)
    if (rect?.kind === 'Text' && element !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      editText(sketch.id, rect, element)
    }
  })
  const marqueeElement = document.createElement('div')
  marqueeElement.dataset['taoStudioSketchMarquee'] = sketch.id
  marqueeElement.style.pointerEvents = 'none'
  marqueeElement.style.position = 'absolute'
  /** selectRects makes a set of free rectangles the selection, or clears it when the set is empty. */
  const selectRects = (rectIds: ReadonlySet<string>): void => {
    const [first] = rectIds
    state = { ...state, selectedId: first }
    select(first === undefined ? undefined : { rectId: first, rectIds, sketchId: sketch.id })
    paint()
  }
  const sweep = (event: PointerEvent): StudioSketchBox | undefined => {
    if (marquee === undefined) {
      return undefined
    }
    const box = StudioSketchMarquee.box(marquee.origin, point(event))
    Object.assign(marqueeElement.style, {
      height: `${box.height}px`,
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
    })
    if (!board.contains(marqueeElement)) {
      board.append(marqueeElement)
    }
    return box
  }
  const endMarquee = (pointerId: number): void => {
    marquee = undefined
    marqueeElement.remove()
    releasePointer(pointerId)
  }
  board.addEventListener('pointermove', event => {
    const box = event.pointerId === activePointer ? sweep(event) : undefined
    if (box !== undefined && marquee !== undefined) {
      selectRects(StudioSketchMarquee.pick(state.rects, box, marquee.before, marquee.additive))
      return
    }
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
    if (marquee !== undefined) {
      endMarquee(event.pointerId)
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
    const sweeping = marquee
    const box = sweep(event)
    if (sweeping !== undefined && box !== undefined) {
      endMarquee(event.pointerId)
      // A press that swept nothing was a click on the frame itself; Shift keeps what was selected.
      if (!StudioSketchMarquee.click(box)) {
        selectRects(StudioSketchMarquee.pick(state.rects, box, sweeping.before, sweeping.additive))
      } else if (sweeping.additive) {
        selectRects(sweeping.before)
      } else {
        selectFrame()
      }
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
    // A press on the empty board that drew nothing was a click on the frame itself.
    const clickedFrame = gesture.kind === 'draw' && !state.rects.some(candidate => candidate.id === gesture.id)
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
    if (clickedFrame) {
      selectFrame()
    }
    // The tool goes back to V on release, not when the commit answers: a tool picked in between is the person's.
    if (change?.kind === 'add') {
      tools.handBack()
    }
    StudioSketchPointerRelease.afterCommit(
      () => change === undefined ? undefined : onChange?.(change),
      () => {
        releasePointer(event.pointerId)
        if (change?.kind === 'add') {
          tools.drawn(sketch.id, change.rect.id)
        }
      },
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
function relativePoint(element: HTMLElement, event: MouseEvent): StudioSketchPoint {
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
  existing?: HTMLElement,
  example?: StudioFeedSample,
): HTMLElement {
  const element = existing ?? document.createElement('div')
  element.dataset['taoStudioSketchRect'] = rect.id
  element.dataset['taoStudioSketchRectKind'] = rect.kind
  element.style.height = `${rect.height}px`
  element.style.left = `${rect.x}px`
  element.style.position = 'absolute'
  element.style.top = `${rect.y}px`
  element.style.width = `${rect.width}px`
  // Keep the hit element attached between the two clicks of a native double-click.
  const sampleSignature = JSON.stringify(example ?? null)
  if (
    existing !== undefined && (element.dataset['selected'] === 'true') === selected
    && element.dataset['taoStudioSample'] === sampleSignature
  ) {
    return element
  }
  element.dataset['taoStudioSample'] = sampleSignature
  element.textContent = example?.text ?? rect.content ?? rect.kind
  if (example?.imageUrl !== undefined) {
    const image = document.createElement('img')
    image.src = example.imageUrl
    image.alt = example.label
    image.draggable = false
    image.style.width = '100%'
    image.style.height = '100%'
    image.style.objectFit = 'contain'
    image.style.pointerEvents = 'none'
    element.replaceChildren(image)
  }
  delete element.dataset['selected']
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
