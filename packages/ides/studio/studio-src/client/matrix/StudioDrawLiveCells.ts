/**
 * Draw shows each drawn view running under its drawing. The preview grid keeps owning the cells, so
 * their iframes never reload: in Draw the grid lies beneath the transparent Draw canvas under the
 * same pan and zoom, every row that renders a drawn view is moved under that view's slot on the
 * canvas, and the slot grows to the row's height so the frame's controls sit below the running view.
 * Other frames' boards paint over the running views and stay editable. Rows with no slot stay
 * hidden. Both surfaces share one origin and one transform, so a slot's layout offset inside the
 * Draw canvas is exactly where its row belongs inside the grid.
 */

/** The live-height custom property a slot reads, so leaving Draw needs no memory of what it held. */
export const studioDrawLiveHeight = '--studio-draw-live-height'

/**
 * The frame size a placed row's cells run at. The cell's own inline size is the scenario's device,
 * which every revision rewrites; the stylesheet lets these win in Draw, and leaving Draw drops them.
 */
const studioDrawFrameWidth = '--studio-draw-frame-width'
const studioDrawFrameHeight = '--studio-draw-frame-height'

/** A running view under the pointer that a dragged frame can be dropped into. */
export type StudioDrawLiveTarget = Readonly<{
  cellId: string
  /** The Tao file the view is written in and the version its running cell compiled, when known. */
  source?: Readonly<{ path: string; version: string }>
  view: string
}>

type Point = Readonly<{ x: number; y: number }>

export const StudioDrawLiveCells = {
  place: placeLiveCells,
  /**
   * connect keeps the placement current until the returned disconnect: after the grid reconciles,
   * a frame renders or moves, a row resizes, or the preset changes, coalesced to one frame.
   */
  connect(parent: HTMLElement): () => void {
    const window = parent.ownerDocument.defaultView
    if (window === null || typeof MutationObserver === 'undefined') {
      return () => {}
    }
    let scheduled: number | undefined
    const schedule = (): void => {
      if (scheduled === undefined) {
        scheduled = window.requestAnimationFrame(() => {
          scheduled = undefined
          placeLiveCells(parent)
        })
      }
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(parent, {
      attributeFilter: [
        'style',
        'data-canvas-workspace',
        'data-tao-studio-sketch-drop-into',
        'data-tao-studio-draw-live-width',
        'data-tao-studio-draw-live-height',
      ],
      attributes: true,
      childList: true,
      subtree: true,
    })
    const sizes = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    const observed = new Set<Element>()
    const observeRows = (): void => {
      for (const row of liveRows(parent)) {
        if (!observed.has(row)) {
          observed.add(row)
          sizes?.observe(row)
        }
      }
    }
    const rowWatch = new MutationObserver(observeRows)
    rowWatch.observe(parent, { childList: true, subtree: true })
    observeRows()
    schedule()
    return () => {
      mutations.disconnect()
      rowWatch.disconnect()
      sizes?.disconnect()
      if (scheduled !== undefined) {
        window.cancelAnimationFrame(scheduled)
      }
    }
  },
  /**
   * at names the running view whose cell holds the viewport point, leaving out `except`, the view
   * being dragged, since a view cannot be dropped into itself.
   */
  at(parent: HTMLElement, point: Point, except?: string): StudioDrawLiveTarget | undefined {
    for (const row of liveRows(parent)) {
      const view = row.dataset['taoStudioGroupSketchView']
      if (row.dataset['taoStudioDrawLive'] !== 'true' || view === undefined || view === except) {
        continue
      }
      for (const cell of row.querySelectorAll<HTMLElement>('[data-tao-studio-cell]')) {
        const rect = cell.getBoundingClientRect()
        if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
          const path = row.dataset['taoStudioGroupSourcePath']
          const version = row.dataset['taoStudioGroupSourceVersion']
          return {
            cellId: cell.dataset['taoStudioCell']!,
            ...(path === undefined || version === undefined ? {} : { source: { path, version } }),
            view,
          }
        }
      }
    }
    return undefined
  },
} as const

function liveRows(parent: HTMLElement): readonly HTMLElement[] {
  return [...parent.querySelectorAll<HTMLElement>(':scope > .studio-preview-grid > [data-tao-studio-group]')]
}

function placeLiveCells(parent: HTMLElement): void {
  const grid = parent.querySelector<HTMLElement>(':scope > .studio-preview-grid')
  const canvas = parent.querySelector<HTMLElement>(':scope > [data-tao-studio-draw-canvas]')
  const draw = parent.dataset['canvasWorkspace'] === 'draw' && canvas !== null
  // Outside Draw every slot is still collected, so each one gives its live height back.
  const allSlots = canvas === null ? [] : [...canvas.querySelectorAll<HTMLElement>('[data-tao-studio-draw-live-slot]')]
  const slots = new Map(draw ? allSlots.map(slot => [slot.dataset['taoStudioDrawLiveSlot']!, slot] as const) : [])
  // The cell a hovering frame would drop into, which the frame names while it is dragged over it.
  const hovered = draw
    ? canvas.querySelector<HTMLElement>('[data-tao-studio-sketch-drop-into]')?.dataset['taoStudioSketchDropInto']
    : undefined
  const filled = new Set<HTMLElement>()
  let right = 0
  let bottom = 0
  for (const row of liveRows(parent)) {
    for (const cell of row.querySelectorAll<HTMLElement>('[data-tao-studio-cell]')) {
      writeFlag(cell, 'taoStudioDropIntoTarget', cell.dataset['taoStudioCell'] === hovered)
    }
    const view = row.dataset['taoStudioGroupSketchView']
    const slot = view === undefined ? undefined : slots.get(view)
    const at = slot === undefined || canvas === null ? undefined : offsetWithin(slot, canvas)
    if (slot === undefined || at === undefined) {
      clearRow(row)
      continue
    }
    writeFlag(row, 'taoStudioDrawLive', true)
    writeStyle(row, 'left', `${at.x}px`)
    writeStyle(row, 'top', `${at.y}px`)
    writeStyle(row, studioDrawFrameWidth, pixels(slot.dataset['taoStudioDrawLiveWidth']))
    writeStyle(row, studioDrawFrameHeight, pixels(slot.dataset['taoStudioDrawLiveHeight']))
    const height = row.offsetHeight
    if (height > 0) {
      writeStyle(slot, studioDrawLiveHeight, `${height}px`)
      filled.add(slot)
    }
    right = Math.max(right, at.x + row.offsetWidth)
    bottom = Math.max(bottom, at.y + height)
  }
  for (const slot of allSlots) {
    writeFlag(slot, 'taoStudioDrawLiveFilled', filled.has(slot))
    if (!filled.has(slot)) {
      writeStyle(slot, studioDrawLiveHeight, '')
    }
  }
  if (grid !== null) {
    // The grid's box must reach every placed row: preview cells suspend once they leave it.
    writeStyle(grid, 'min-width', draw && right > 0 ? `max(100%, ${Math.ceil(right)}px)` : '')
    writeStyle(grid, 'min-height', draw && bottom > 0 ? `max(100%, ${Math.ceil(bottom)}px)` : '')
  }
}

function clearRow(row: HTMLElement): void {
  writeFlag(row, 'taoStudioDrawLive', false)
  writeStyle(row, 'left', '')
  writeStyle(row, 'top', '')
  writeStyle(row, studioDrawFrameWidth, '')
  writeStyle(row, studioDrawFrameHeight, '')
}

/** A frame dimension as a CSS length, or nothing when the slot does not carry a usable one. */
function pixels(value: string | undefined): string {
  const number = Number(value)
  return value !== undefined && Number.isFinite(number) && number > 0 ? `${number}px` : ''
}

/** A slot's layout offset inside the Draw canvas, which pan and zoom never change. */
function offsetWithin(element: HTMLElement, ancestor: HTMLElement): Point | undefined {
  let x = 0
  let y = 0
  let node: HTMLElement | null = element
  while (node !== null && node !== ancestor) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return node === ancestor ? { x: Math.round(x), y: Math.round(y) } : undefined
}

/** Writes only what changed, so a placement never feeds the observer that scheduled it. */
function writeStyle(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) !== value) {
    if (value === '') {
      element.style.removeProperty(property)
    } else {
      element.style.setProperty(property, value)
    }
  }
}

function writeData(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) {
    element.dataset[key] = value
  }
}

function writeFlag(element: HTMLElement, key: string, on: boolean): void {
  if (on) {
    writeData(element, key, 'true')
  } else if (element.dataset[key] !== undefined) {
    delete element.dataset[key]
  }
}
