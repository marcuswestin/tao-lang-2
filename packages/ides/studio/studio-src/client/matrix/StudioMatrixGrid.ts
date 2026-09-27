import { applyCanvasViewport } from './StudioCanvasViewport'
import type { StudioMatrixGroup } from './StudioMatrixLayout'

/** Canvas mode state per matrix parent: the view shown alone and the way back the bar's button runs. */
type StudioCanvasState = {
  exit?: () => void
  focused?: string
}

const canvasStates = new WeakMap<HTMLElement, StudioCanvasState>()

function canvasState(parent: HTMLElement): StudioCanvasState {
  const state = canvasStates.get(parent) ?? {}
  canvasStates.set(parent, state)
  return state
}

/** Keyed DOM host for scenario-group rows and their left-to-right preview cells. */
export const StudioMatrixGrid = {
  reconcile: reconcileMatrix,
  /** focusView enters or leaves canvas mode for one view; `exit` runs when the bar's Back is pressed. */
  focusView: focusCanvasView,
  /** focusedView reports the view canvas mode currently shows alone, if any. */
  focusedView(parent: HTMLElement): string | undefined {
    return canvasStates.get(parent)?.focused
  },
} as const

function reconcileMatrix<Item>(
  parent: HTMLElement,
  groups: readonly StudioMatrixGroup<Item>[],
  render: (frame: HTMLElement, item: Item) => void,
): void {
  const document = parent.ownerDocument
  const canvas = parent.querySelector<HTMLElement>(':scope > .studio-preview-grid') ?? document.createElement('div')
  canvas.className = 'studio-preview-grid'
  canvas.dataset['taoStudioCanvas'] = 'true'
  const frames = new Map([...canvas.querySelectorAll<HTMLElement>('[data-tao-studio-cell]')]
    .map(frame => [frame.dataset['taoStudioCell']!, frame]))
  const rows = new Map([...canvas.querySelectorAll<HTMLElement>(':scope > [data-tao-studio-group]')]
    .map(row => [row.dataset['taoStudioGroup']!, row]))
  const nextRows = groups.map(group => {
    const row = rows.get(group.id) ?? document.createElement('section')
    row.className = 'studio-preview-group'
    row.dataset['taoStudioGroup'] = group.id
    if (group.subjectView === undefined || group.subjectViewId === undefined) {
      delete row.dataset['taoStudioGroupView']
      delete row.dataset['taoStudioGroupViewId']
    } else {
      row.dataset['taoStudioGroupView'] = group.subjectView
      row.dataset['taoStudioGroupViewId'] = group.subjectViewId
    }
    const heading = row.querySelector<HTMLElement>(':scope > .studio-preview-group-label')
      ?? document.createElement('h2')
    heading.className = 'studio-preview-group-label'
    heading.textContent = group.label
    const cells = row.querySelector<HTMLElement>(':scope > .studio-preview-group-cells')
      ?? document.createElement('div')
    cells.className = 'studio-preview-group-cells'
    const nextFrames = group.cells.map(cell => {
      const existing = frames.get(cell.id)
      if (existing !== undefined) {
        return existing
      }
      const frame = document.createElement('section')
      frame.className = 'studio-preview-cell'
      frame.dataset['taoStudioCell'] = cell.id
      render(frame, cell.item)
      return frame
    })
    reconcileElementChildren(cells, nextFrames)
    reconcileElementChildren(row, [heading, cells])
    return row
  })
  reconcileElementChildren(canvas, nextRows)
  if (!parent.contains(canvas)) {
    parent.append(canvas)
  }
  retireDepartedPreviewChildren(parent, canvas)
  applyCanvasFocus(parent)
  applyCanvasViewport(parent)
}

/**
 * The grid is appended rather than replacing the parent, because the Draw canvas is mounted beside it
 * and a compile remount must not steal it. Everything else the preview pane held before the matrix
 * arrived -- the connecting placeholder, and the whole-app iframe an app without scenarios ran in --
 * has no owner once the grid is up, so it is removed here rather than left stacked over the cells.
 * The zoom pill, the focus bar, the Draw tool strip, the edit log and the selection HUD belong to the
 * canvas surface and stay.
 */
function retireDepartedPreviewChildren(parent: HTMLElement, canvas: HTMLElement): void {
  const kept = [
    'data-tao-studio-draw-canvas',
    'data-tao-studio-draw-tools',
    'data-tao-studio-canvas-zoom',
    'data-tao-studio-canvas-bar',
    'data-tao-studio-edit-log',
    'data-tao-studio-selection-hud',
  ]
  for (const child of [...parent.children]) {
    if (child === canvas || kept.some(attribute => child.hasAttribute(attribute))) {
      continue
    }
    child.remove()
  }
}

/**
 * Canvas mode shows one view alone: every scenario group that does not focus that view is hidden,
 * and a bar above the grid names the view and offers the way back. Cells stay mounted, so the app's
 * own previews keep their state while the person works on the one definition.
 */
function focusCanvasView(parent: HTMLElement, viewId: string | undefined, exit: () => void): void {
  const state = canvasState(parent)
  if (viewId === undefined) {
    delete state.focused
  } else {
    state.focused = viewId
  }
  parent.dataset['taoStudioCanvasExit'] = 'true'
  state.exit = exit
  applyCanvasFocus(parent)
}

function applyCanvasFocus(parent: HTMLElement): void {
  const focused = canvasStates.get(parent)?.focused
  const document = parent.ownerDocument
  const canvas = parent.querySelector<HTMLElement>(':scope > .studio-preview-grid')
  if (canvas === null) {
    return
  }
  // The bar sits beside the grid rather than inside it: the grid carries the canvas transform, and
  // a bar under that transform would shrink and drift away with the surface it describes.
  const rows = [...canvas.querySelectorAll<HTMLElement>(':scope > [data-tao-studio-group]')]
  // A focused view no scenario renders any more (renamed, removed, or its file no longer compiles)
  // leaves nothing to show alone. The app stays visible under the bar instead of the grid going blank.
  const shown = focused !== undefined && rows.some(row => row.dataset['taoStudioGroupViewId'] === focused)
  for (const row of rows) {
    row.hidden = shown && row.dataset['taoStudioGroupViewId'] !== focused
  }
  const existing = parent.querySelector<HTMLElement>(':scope > .studio-canvas-bar')
  if (focused === undefined) {
    existing?.remove()
    delete parent.dataset['taoStudioCanvasFocus']
    return
  }
  parent.dataset['taoStudioCanvasFocus'] = focused
  const bar = existing ?? document.createElement('div')
  bar.className = 'studio-canvas-bar'
  bar.dataset['taoStudioCanvasBar'] = focused
  const label = bar.querySelector<HTMLElement>(':scope > span') ?? document.createElement('span')
  const viewName = rows.find(row => row.dataset['taoStudioGroupViewId'] === focused)?.dataset['taoStudioGroupView']
    ?? focused.split('#').at(-1)
    ?? focused
  label.textContent = shown
    ? `Editing ${viewName} on its own. Changes land in that one view definition.`
    : `${viewName} is not rendered by any scenario right now, so the whole app is shown.`
  const back = bar.querySelector<HTMLButtonElement>(':scope > button') ?? document.createElement('button')
  back.type = 'button'
  back.textContent = 'Back to app'
  back.dataset['taoStudioCanvasBack'] = 'true'
  back.onclick = () => canvasStates.get(parent)?.exit?.()
  bar.replaceChildren(label, back)
  parent.prepend(bar)
}

/**
 * Moves keyed matrix nodes in place so retained preview iframes keep their browsing contexts.
 * Departed children go first, so a removal never shuffles the survivors behind it: a detach and
 * reattach reloads an iframe and takes the pointer capture from a sketch board mid-gesture.
 */
function reconcileElementChildren(parent: HTMLElement, next: readonly HTMLElement[]): void {
  const kept = new Set<Element>(next)
  for (const child of [...parent.children]) {
    if (!kept.has(child)) {
      child.remove()
    }
  }
  for (const [index, element] of next.entries()) {
    const current = parent.children.item(index)
    if (current !== element) {
      moveElementBefore(parent, element, current)
    }
  }
}

/** A reorder uses the browser's state-preserving move where it exists and falls back to insertBefore. */
function moveElementBefore(parent: HTMLElement, element: HTMLElement, before: Element | null): void {
  const movable = parent as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }
  if (typeof movable.moveBefore === 'function' && element.parentNode === parent) {
    movable.moveBefore(element, before)
  } else {
    parent.insertBefore(element, before)
  }
}
