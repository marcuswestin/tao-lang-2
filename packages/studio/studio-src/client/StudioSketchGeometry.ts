export type StudioSketchPoint = Readonly<{ x: number; y: number }>

/** StudioSketchRect mirrors the FS-D1 rectangle fields, with a stable client/catalog identity. */
export type StudioSketchRect = Readonly<{
  binding?: string
  content?: string
  height: number
  id: string
  kind: string
  width: number
  x: number
  y: number
}>

export type StudioSketchResizeHandle =
  | 'east'
  | 'north'
  | 'north-east'
  | 'north-west'
  | 'south'
  | 'south-east'
  | 'south-west'
  | 'west'

type StudioSketchGesture = Readonly<{
  beforeRects: readonly StudioSketchRect[]
  beforeSelectedId?: string
  handle?: StudioSketchResizeHandle
  id: string
  kind: 'draw' | 'move' | 'resize'
  origin: StudioSketchPoint
  original: StudioSketchRect
}>

export type StudioSketchGeometryState = Readonly<{
  gesture?: StudioSketchGesture
  rects: readonly StudioSketchRect[]
  selectedId?: string
}>

export type StudioSketchDrawDetails = Readonly<{
  binding?: string
  content?: string
  kind: string
}>

export type StudioSketchMoveOptions = Readonly<{
  duplicateId?: string
  optionKey?: boolean
}>

export type StudioSketchInlineUpdate = Readonly<{
  content?: string | undefined
  kind?: string
}>

const minimumDrawExtent = 4
const minimumResizeExtent = 1

export const StudioSketchGeometry = {
  minimumDrawExtent,
  minimumResizeExtent,

  beginDraw(
    state: StudioSketchGeometryState,
    id: string,
    origin: StudioSketchPoint,
    details: StudioSketchDrawDetails = { kind: 'Placeholder' },
  ): StudioSketchGeometryState {
    if (state.gesture !== undefined || state.rects.some(rect => rect.id === id)) {
      return state
    }
    const rect: StudioSketchRect = { ...details, height: 0, id, width: 0, ...origin }
    return {
      gesture: gestureSnapshot(state, { id, kind: 'draw', origin, original: rect }),
      rects: [...state.rects, rect],
      selectedId: id,
    }
  },

  beginMove(
    state: StudioSketchGeometryState,
    origin: StudioSketchPoint,
    options: StudioSketchMoveOptions = {},
  ): StudioSketchGeometryState {
    if (state.gesture !== undefined) {
      return state
    }
    const hit = hitRect(state.rects, origin)
    if (hit === undefined) {
      return { rects: state.rects }
    }
    const duplicate = options.optionKey === true
    const id = duplicate ? options.duplicateId : hit.id
    if (id === undefined || (duplicate && state.rects.some(rect => rect.id === id))) {
      return state
    }
    const moving = duplicate ? { ...hit, id } : hit
    return {
      gesture: gestureSnapshot(state, { id, kind: 'move', origin, original: moving }),
      rects: duplicate ? [...state.rects, moving] : state.rects,
      selectedId: id,
    }
  },

  beginResize(
    state: StudioSketchGeometryState,
    handle: StudioSketchResizeHandle,
    origin: StudioSketchPoint,
  ): StudioSketchGeometryState {
    if (state.gesture !== undefined || state.selectedId === undefined) {
      return state
    }
    const rect = state.rects.find(candidate => candidate.id === state.selectedId)
    return rect === undefined
      ? state
      : {
        ...state,
        gesture: gestureSnapshot(state, { handle, id: rect.id, kind: 'resize', origin, original: rect }),
      }
  },

  cancelPointer(state: StudioSketchGeometryState): StudioSketchGeometryState {
    const gesture = state.gesture
    return gesture === undefined
      ? state
      : { rects: gesture.beforeRects, selectedId: gesture.beforeSelectedId }
  },

  endPointer(state: StudioSketchGeometryState, point?: StudioSketchPoint): StudioSketchGeometryState {
    const updated = point === undefined ? state : StudioSketchGeometry.updatePointer(state, point)
    const gesture = updated.gesture
    if (gesture === undefined) {
      return updated
    }
    const rect = updated.rects.find(candidate => candidate.id === gesture.id)
    if (
      gesture.kind === 'draw'
      && (rect === undefined || rect.width < minimumDrawExtent || rect.height < minimumDrawExtent)
    ) {
      return { rects: gesture.beforeRects, selectedId: gesture.beforeSelectedId }
    }
    return { rects: updated.rects, selectedId: updated.selectedId }
  },

  hit(rects: readonly StudioSketchRect[], point: StudioSketchPoint): StudioSketchRect | undefined {
    return hitRect(rects, point)
  },

  initial(rects: readonly StudioSketchRect[] = []): StudioSketchGeometryState {
    return { rects: [...rects] }
  },

  select(state: StudioSketchGeometryState, point: StudioSketchPoint): StudioSketchGeometryState {
    const selectedId = hitRect(state.rects, point)?.id
    return selectedId === undefined ? { rects: state.rects } : { rects: state.rects, selectedId }
  },

  updatePointer(state: StudioSketchGeometryState, point: StudioSketchPoint): StudioSketchGeometryState {
    const gesture = state.gesture
    if (gesture === undefined) {
      return state
    }
    const delta = { x: point.x - gesture.origin.x, y: point.y - gesture.origin.y }
    const rect = gesture.kind === 'draw'
      ? normalizedRect(gesture.original, gesture.origin, point)
      : gesture.kind === 'move'
      ? {
        ...gesture.original,
        x: Math.max(0, gesture.original.x + delta.x),
        y: Math.max(0, gesture.original.y + delta.y),
      }
      : resizedRect(gesture.original, gesture.handle!, delta)
    return { ...state, rects: replaceRect(state.rects, rect) }
  },

  updateSelected(
    state: StudioSketchGeometryState,
    update: StudioSketchInlineUpdate,
  ): StudioSketchGeometryState {
    if (state.selectedId === undefined) {
      return state
    }
    return {
      ...state,
      rects: state.rects.map(rect => rect.id === state.selectedId ? { ...rect, ...update } : rect),
    }
  },
} as const

function gestureSnapshot(
  state: StudioSketchGeometryState,
  gesture: Omit<StudioSketchGesture, 'beforeRects' | 'beforeSelectedId'>,
): StudioSketchGesture {
  return { ...gesture, beforeRects: state.rects, beforeSelectedId: state.selectedId }
}

function hitRect(rects: readonly StudioSketchRect[], point: StudioSketchPoint): StudioSketchRect | undefined {
  return rects.findLast(rect =>
    point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height
  )
}

function normalizedRect(
  original: StudioSketchRect,
  first: StudioSketchPoint,
  second: StudioSketchPoint,
): StudioSketchRect {
  return {
    ...original,
    height: Math.abs(second.y - first.y),
    width: Math.abs(second.x - first.x),
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
  }
}

function replaceRect(rects: readonly StudioSketchRect[], replacement: StudioSketchRect): readonly StudioSketchRect[] {
  return rects.map(rect => rect.id === replacement.id ? replacement : rect)
}

function resizedRect(
  rect: StudioSketchRect,
  handle: StudioSketchResizeHandle,
  delta: StudioSketchPoint,
): StudioSketchRect {
  const movesNorth = handle.startsWith('north')
  const movesSouth = handle.startsWith('south')
  const movesWest = handle.endsWith('west') || handle === 'west'
  const movesEast = handle.endsWith('east') || handle === 'east'
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const x = movesWest ? Math.max(0, Math.min(rect.x + delta.x, right - minimumResizeExtent)) : rect.x
  const y = movesNorth ? Math.max(0, Math.min(rect.y + delta.y, bottom - minimumResizeExtent)) : rect.y
  return {
    ...rect,
    height: movesNorth ? bottom - y : movesSouth ? Math.max(minimumResizeExtent, rect.height + delta.y) : rect.height,
    width: movesWest ? right - x : movesEast ? Math.max(minimumResizeExtent, rect.width + delta.x) : rect.width,
    x,
    y,
  }
}
