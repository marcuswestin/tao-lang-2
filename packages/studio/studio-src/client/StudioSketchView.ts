import type {
  StudioSketchFlowAction,
  StudioSketchSnapApplyResult,
  StudioSketchSnapProposalResult,
  StudioSketchSnapUndoResult,
} from '../StudioProjectSession'
import type { StudioSketch, StudioSketchRect } from '../StudioSketchCatalog'
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
  onCreateSketch?: (input: Readonly<{ height: number; width: number }>) => Promise<void> | void
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
}>

export type StudioSketchViewSnapRequest = Readonly<{
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

export type StudioSketchViewUndoRequest = Readonly<{
  checkpointId: string
  sourceVersion: string
}>

type StudioSketchSnapUiState = {
  lastCheckpointId?: string
  pending?: StudioSketchSnapProposalResult
  pendingCheckpointId?: string
  sourceVersion?: string
}

export type StudioSketchViewUnsnapRequest = Readonly<{
  checkpointId: string
  rectIds: readonly string[]
  sketchId: string
  sourceVersion: string
}>

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

export type MountedStudioSketchView = Readonly<{
  dispose(): void
  render(sketches: readonly StudioSketch[], sourceVersion?: string): void
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
    size?: Readonly<{ height: number; width: number }>
  }> {
    if (gesture === undefined || gesture.pointerId !== pointerId) {
      return { gesture }
    }
    const width = Math.round(Math.abs(point.x - gesture.origin.x))
    const height = Math.round(Math.abs(point.y - gesture.origin.y))
    return width < StudioSketchGeometry.minimumDrawExtent || height < StudioSketchGeometry.minimumDrawExtent
      ? {}
      : { size: { height, width } }
  },
} as const

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
    workspace.style.minHeight = '140px'
    workspace.style.minWidth = '400px'
    workspace.style.overflow = 'visible'
    workspace.style.padding = '24px'
    const inspector = document.createElement('aside')
    inspector.dataset['taoStudioSketchInspector'] = 'true'
    inspector.hidden = true
    inspector.style.width = '180px'
    let sketches = options.sketches
    let currentSourceVersion = options.sourceVersion
    const snapStates = new Map<string, StudioSketchSnapUiState>()
    let selected: Readonly<{ rectId: string; rectIds: ReadonlySet<string>; sketchId: string }> | undefined
    let outerGesture: StudioSketchOuterGesture | undefined

    const applyChange = (change: StudioSketchRectChange): void => {
      sketches = StudioSketchChanges.settle(sketches, change)
      selected = { rectId: change.rect.id, rectIds: new Set([change.rect.id]), sketchId: change.sketchId }
      render(sketches)
    }
    const commit = (change: StudioSketchRectChange): void => {
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
          void result.then(settle, error => {
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

    const render = (nextSketches: readonly StudioSketch[], nextSourceVersion?: string): void => {
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
            const state = snapStates.get(sketch.id) ?? { sourceVersion: currentSourceVersion }
            state.sourceVersion = currentSourceVersion ?? state.sourceVersion
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
          (authoritative, version) => render(authoritative, version),
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
      event.preventDefault()
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
      if (result.size === undefined) {
        return
      }
      try {
        const persistence = options.onCreateSketch?.(result.size)
        if (persistence instanceof Promise) {
          void persistence.catch(error => options.onError?.(error))
        }
      } catch (error) {
        options.onError?.(error)
      }
    }
    workspace.addEventListener('pointerup', finishOuter)
    workspace.addEventListener('pointercancel', event => {
      if (event.pointerId !== outerGesture?.pointerId) {
        return
      }
      outerGesture = StudioSketchOuterDrawing.cancel(outerGesture, event.pointerId)
      workspace.releasePointerCapture?.(event.pointerId)
      delete workspace.dataset['taoStudioSketchDrawing']
    })
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

function renderSketch(
  document: Document,
  sketch: StudioSketch,
  snapState: StudioSketchSnapUiState,
  selection: () => Readonly<{ rectId: string; rectIds: ReadonlySet<string>; sketchId: string }> | undefined,
  select: (value: Readonly<{ rectId: string; rectIds: ReadonlySet<string>; sketchId: string }> | undefined) => void,
  onChange: StudioSketchViewOptions['onRectChange'],
  onFlowAction: StudioSketchViewOptions['onFlowAction'],
  onSnap: StudioSketchViewOptions['onSnap'],
  onUnsnap: StudioSketchViewOptions['onUnsnap'],
  onUndoSnap: StudioSketchViewOptions['onUndoSnap'],
  renderAuthoritative: (sketches: readonly StudioSketch[], sourceVersion: string) => void,
): HTMLElement {
  const board = document.createElement('section')
  board.dataset['taoStudioSketch'] = sketch.id
  board.style.height = `${sketch.height}px`
  board.style.minWidth = `${sketch.width}px`
  board.style.position = 'relative'
  board.style.width = `${sketch.width}px`
  let activePointer: number | undefined
  let duplicateSourceId: string | undefined
  let draggingRectId: string | undefined
  let busy = false
  let state: StudioSketchGeometryState = StudioSketchGeometry.initial(sketch.rects)
  if (selection()?.sketchId === sketch.id) {
    state = { ...state, selectedId: selection()?.rectId }
  }
  const paint = (): void => {
    const selectedIds = selection()?.sketchId === sketch.id
      ? selection()?.rectIds ?? new Set<string>()
      : new Set<string>()
    const children = state.rects.map(rect =>
      rectElement(document, rect, selectedIds.has(rect.id), beginResize, event => {
        draggingRectId = rect.id
        event.dataTransfer?.setData('text/plain', rect.id)
        gapIndicator.hidden = false
      })
    )
    board.replaceChildren(
      toolbar,
      gapIndicator,
      ...children,
      ...(snapState.pending === undefined ? [] : [proposalElement()]),
    )
  }
  const toolbar = document.createElement('nav')
  toolbar.dataset['taoStudioSketchSnapControls'] = sketch.id
  toolbar.style.position = 'absolute'
  toolbar.style.top = '-32px'
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
  const gapIndicator = document.createElement('div')
  gapIndicator.dataset['taoStudioSketchGapIndicator'] = 'true'
  gapIndicator.textContent = 'Drop to Snap selected rectangle into flow'
  gapIndicator.hidden = true
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
      board.dataset['taoStudioSketchError'] = error instanceof Error ? error.message : String(error)
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
      snapState.lastCheckpointId = result.checkpoint.id
      snapState.sourceVersion = result.file.sourceVersion
      renderAuthoritative(result.catalog.sketches, result.file.sourceVersion)
    } catch (error) {
      board.dataset['taoStudioSketchError'] = error instanceof Error ? error.message : String(error)
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
        snapState.lastCheckpointId = undefined
        snapState.sourceVersion = result.file.sourceVersion
        renderAuthoritative(result.catalog.sketches, result.file.sourceVersion)
      },
      error => {
        undo.disabled = false
        board.dataset['taoStudioSketchError'] = error instanceof Error ? error.message : String(error)
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
      snapState.lastCheckpointId = result.checkpoint.id
      snapState.sourceVersion = result.file.sourceVersion
      undo.disabled = false
      renderAuthoritative(result.catalog.sketches, result.file.sourceVersion)
    }, error => {
      unsnap.disabled = false
      board.dataset['taoStudioSketchError'] = error instanceof Error ? error.message : String(error)
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
  const point = (event: PointerEvent): StudioSketchPoint => {
    const bounds = board.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
  const beginResize = (event: PointerEvent, handle: StudioSketchResizeHandle): void => {
    if (activePointer !== undefined || !primaryPointer(event)) {
      return
    }
    event.stopPropagation()
    state = StudioSketchGeometry.beginResize(state, handle, point(event))
    if (state.gesture === undefined) {
      return
    }
    activePointer = event.pointerId
    board.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  board.addEventListener('pointerdown', event => {
    if (activePointer !== undefined || !primaryPointer(event)) {
      return
    }
    if ((event.target as HTMLElement).dataset['taoStudioSketchHandle']) {
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
    activePointer = event.pointerId
    board.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    paint()
  })
  board.addEventListener('pointermove', event => {
    if (state.gesture === undefined || event.pointerId !== activePointer) {
      return
    }
    state = StudioSketchGeometry.updatePointer(state, point(event))
    paint()
  })
  board.addEventListener('pointercancel', event => {
    if (event.pointerId !== activePointer) {
      return
    }
    state = StudioSketchGeometry.cancelPointer(state)
    activePointer = undefined
    duplicateSourceId = undefined
    board.releasePointerCapture?.(event.pointerId)
    paint()
  })
  board.addEventListener('pointerup', event => {
    if (event.pointerId !== activePointer) {
      return
    }
    const gesture = state.gesture
    if (gesture === undefined) {
      return
    }
    state = StudioSketchGeometry.endPointer(state, point(event))
    activePointer = undefined
    board.releasePointerCapture?.(event.pointerId)
    const rect = state.rects.find(candidate => candidate.id === state.selectedId)
    if (rect !== undefined) {
      const kind = gesture.kind === 'draw'
        ? 'add'
        : gesture.kind === 'move' && gesture.beforeRects.length < state.rects.length
        ? 'duplicate'
        : 'update'
      if (kind !== 'update' || !StudioSketchChanges.equal(rect, gesture.original)) {
        onChange?.({
          kind,
          rect,
          sketchId: sketch.id,
          ...(kind === 'duplicate' ? { sourceRectId: duplicateSourceId } : {}),
        })
      }
    }
    duplicateSourceId = undefined
    paint()
  })
  board.addEventListener('dragover', event => {
    if (draggingRectId === undefined) {
      return
    }
    event.preventDefault()
    gapIndicator.hidden = false
    gapIndicator.dataset['state'] = 'landing'
  })
  board.addEventListener('dragleave', () => {
    gapIndicator.hidden = true
    delete gapIndicator.dataset['state']
  })
  board.addEventListener('drop', event => {
    if (draggingRectId === undefined) {
      return
    }
    event.preventDefault()
    const rectId = draggingRectId
    draggingRectId = undefined
    gapIndicator.hidden = true
    delete gapIndicator.dataset['state']
    void requestSnap([rectId])
  })
  board.addEventListener('dragend', () => {
    draggingRectId = undefined
    gapIndicator.hidden = true
    delete gapIndicator.dataset['state']
  })
  paint()
  return board
}

function primaryPointer(event: PointerEvent): boolean {
  return event.button === 0 && event.isPrimary !== false
}

function relativePoint(element: HTMLElement, event: PointerEvent): StudioSketchPoint {
  const bounds = element.getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

function rectElement(
  document: Document,
  rect: StudioSketchRect,
  selected: boolean,
  beginResize: (event: PointerEvent, handle: StudioSketchResizeHandle) => void,
  beginDrag: (event: DragEvent) => void,
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
  element.draggable = true
  element.addEventListener('dragstart', beginDrag)
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
