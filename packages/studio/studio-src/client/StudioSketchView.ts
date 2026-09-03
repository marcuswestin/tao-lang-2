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
      && left.binding === right.binding
  },
  settle(
    sketches: readonly StudioSketch[],
    change: StudioSketchRectChange,
    authoritative?: readonly StudioSketch[],
  ): readonly StudioSketch[] {
    if (authoritative !== undefined) {
      return authoritative
    }
    return sketches.map(sketch =>
      sketch.id === change.sketchId
        ? {
          ...sketch,
          rects: change.kind === 'add' || change.kind === 'duplicate'
            ? [...sketch.rects, change.rect]
            : sketch.rects.map(rect => rect.id === change.rect.id ? change.rect : rect),
        }
        : sketch
    )
  },
} as const

export type StudioSketchViewOptions = Readonly<{
  onCreateSketch?: (input: Readonly<{ height: number; width: number }>) => Promise<void> | void
  onError?: (error: unknown) => void
  onRectChange?: (
    change: StudioSketchRectChange,
  ) => Promise<readonly StudioSketch[] | void> | readonly StudioSketch[] | void
  sketches: readonly StudioSketch[]
}>

export type MountedStudioSketchView = Readonly<{
  dispose(): void
  render(sketches: readonly StudioSketch[]): void
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
    let selected: Readonly<{ rectId: string; sketchId: string }> | undefined
    let outerGesture: StudioSketchOuterGesture | undefined

    const applyChange = (change: StudioSketchRectChange): void => {
      sketches = StudioSketchChanges.settle(sketches, change)
      selected = { rectId: change.rect.id, sketchId: change.sketchId }
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

    const render = (nextSketches: readonly StudioSketch[]): void => {
      sketches = nextSketches
      const boards = sketches.map(sketch =>
        renderSketch(document, sketch, () => selected, value => {
          selected = value
          renderInspector(inspector, sketches, selected, commit)
        }, commit)
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
  selection: () => Readonly<{ rectId: string; sketchId: string }> | undefined,
  select: (value: Readonly<{ rectId: string; sketchId: string }> | undefined) => void,
  onChange: StudioSketchViewOptions['onRectChange'],
): HTMLElement {
  const board = document.createElement('section')
  board.dataset['taoStudioSketch'] = sketch.id
  board.style.height = `${sketch.height}px`
  board.style.minWidth = `${sketch.width}px`
  board.style.position = 'relative'
  board.style.width = `${sketch.width}px`
  let activePointer: number | undefined
  let duplicateSourceId: string | undefined
  let state: StudioSketchGeometryState = StudioSketchGeometry.initial(sketch.rects)
  if (selection()?.sketchId === sketch.id) {
    state = { ...state, selectedId: selection()?.rectId }
  }
  const paint = (): void => {
    const children = state.rects.map(rect => rectElement(document, rect, selection()?.rectId === rect.id, beginResize))
    board.replaceChildren(...children)
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
      select({ rectId: id, sketchId: sketch.id })
    } else {
      state = { ...state, selectedId: hit.id }
      const duplicateId = event.altKey ? crypto.randomUUID() : undefined
      duplicateSourceId = duplicateId === undefined ? undefined : hit.id
      state = StudioSketchGeometry.beginMove(state, location, { duplicateId, optionKey: event.altKey })
      select({ rectId: state.selectedId!, sketchId: sketch.id })
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
  selected: Readonly<{ rectId: string; sketchId: string }> | undefined,
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
