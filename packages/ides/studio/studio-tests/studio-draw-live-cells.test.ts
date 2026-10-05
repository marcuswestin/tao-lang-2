import { Assert } from '@shared'
import { Expect, Test } from '@shared/test'
import { StudioDrawLiveCells } from '../studio-src/client/matrix/StudioDrawLiveCells'

/** Just enough of an element for placement: data attributes, inline style, layout offsets, and simple selectors. */
class LiveElement {
  children: LiveElement[] = []
  className = ''
  dataset: Record<string, string> = {}
  offsetHeight = 0
  offsetLeft = 0
  offsetParent: LiveElement | null = null
  offsetTop = 0
  offsetWidth = 0
  parent: LiveElement | undefined
  rect = { bottom: 0, left: 0, right: 0, top: 0 }
  readonly properties = new Map<string, string>()
  readonly style = {
    getPropertyValue: (name: string): string => this.properties.get(name) ?? '',
    removeProperty: (name: string): void => {
      this.properties.delete(name)
    },
    setProperty: (name: string, value: string): void => {
      this.properties.set(name, value)
    },
  }

  constructor(className = '', data: Record<string, string> = {}) {
    this.className = className
    this.dataset = { ...data }
  }

  append(...children: LiveElement[]): this {
    for (const child of children) {
      child.parent = this
      this.children.push(child)
    }
    return this
  }

  getBoundingClientRect() {
    return this.rect
  }

  querySelector(selector: string): LiveElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): LiveElement[] {
    const steps = selector.split(' > ')
    let found: LiveElement[] = [this]
    for (const [index, step] of steps.entries()) {
      if (step === ':scope') {
        continue
      }
      const direct = index > 0
      found = found.flatMap(element => direct ? element.children : element.descendants())
        .filter(element => element.matches(step))
    }
    return found
  }

  descendants(): LiveElement[] {
    return this.children.flatMap(child => [child, ...child.descendants()])
  }

  matches(step: string): boolean {
    if (step.startsWith('.')) {
      return this.className.split(' ').includes(step.slice(1))
    }
    const attribute = /^\[data-([a-z-]+)\]$/.exec(step)?.[1]
    Assert.defined(attribute, `supported selector step ${step}`)
    return this.dataset[attribute.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] !== undefined
  }
}

/**
 * A preview host in Draw: a grid holding two drawn views' rows and one app row, and a Draw canvas
 * whose View1 frame holds a slot 40px into a frame at (100, 60).
 */
function drawPreview() {
  const parent = new LiveElement('studio-preview', { canvasWorkspace: 'draw' })
  const grid = new LiveElement('studio-preview-grid')
  const row = (view: string | undefined, cellId: string, height: number) => {
    const cell = new LiveElement('studio-preview-cell', { taoStudioCell: cellId })
    const element = new LiveElement('studio-preview-group', {
      taoStudioGroup: `group-${cellId}`,
      ...(view === undefined
        ? {}
        : {
          taoStudioGroupSketchView: view,
          taoStudioGroupSourcePath: `/project/@/studio/${view}.tao`,
          taoStudioGroupSourceVersion: `version-${view}`,
        }),
    }).append(new LiveElement('studio-preview-group-cells').append(cell))
    element.offsetHeight = height
    element.offsetWidth = 320
    return { cell, element }
  }
  const view1 = row('View1', 'cell-1', 700)
  const view2 = row('View2', 'cell-2', 500)
  const app = row(undefined, 'cell-app', 900)
  grid.append(view1.element, view2.element, app.element)
  const canvas = new LiveElement('studio-draw-canvas', { taoStudioDrawCanvas: 'true' })
  const frame = new LiveElement('', { taoStudioSketchFrame: 'sketch-1' })
  frame.offsetLeft = 100
  frame.offsetTop = 60
  frame.offsetParent = canvas
  const slot = new LiveElement('', {
    taoStudioDrawLiveHeight: '200',
    taoStudioDrawLiveSlot: 'View1',
    taoStudioDrawLiveWidth: '540',
  })
  slot.offsetLeft = 0.4
  slot.offsetTop = 240
  slot.offsetParent = frame
  canvas.append(frame.append(slot))
  parent.append(grid, canvas)
  return { app, canvas, frame, grid, parent, slot, view1, view2 }
}

const place = (parent: LiveElement): void => StudioDrawLiveCells.place(parent as unknown as HTMLElement)

Test(
  'Draw moves a drawn view row onto its frame slot at the frame size, grows the slot, hides rows without one',
  () => {
    const { app, grid, parent, slot, view1, view2 } = drawPreview()
    place(parent)
    Expect(view1.element.dataset['taoStudioDrawLive']).toBe('true')
    Expect(view1.element.properties.get('left')).toBe('100px')
    Expect(view1.element.properties.get('top')).toBe('300px')
    // The running view takes its frame's drawn size, not its scenario's phone.
    Expect(view1.element.properties.get('--studio-draw-frame-width')).toBe('540px')
    Expect(view1.element.properties.get('--studio-draw-frame-height')).toBe('200px')
    Expect(slot.properties.get('--studio-draw-live-height')).toBe('700px')
    Expect(slot.dataset['taoStudioDrawLiveFilled']).toBe('true')
    for (const row of [view2.element, app.element]) {
      Expect(row.dataset['taoStudioDrawLive']).toBeUndefined()
      Expect(row.properties.has('left')).toBe(false)
    }
    // The grid reaches the placed row, so canvas bounds include the live cell.
    Expect(grid.properties.get('min-width')).toBe('max(100%, 420px)')
    Expect(grid.properties.get('min-height')).toBe('max(100%, 1000px)')

    // Leaving Draw hands every row back to the grid and lets the slot shrink to its own size.
    parent.dataset['canvasWorkspace'] = 'design'
    place(parent)
    Expect(view1.element.dataset['taoStudioDrawLive']).toBeUndefined()
    Expect([...view1.element.properties.keys()]).toEqual([])
    Expect(slot.properties.has('--studio-draw-live-height')).toBe(false)
    Expect(slot.dataset['taoStudioDrawLiveFilled']).toBeUndefined()
    Expect([...grid.properties.keys()]).toEqual([])
  },
)

Test('Draw names the running cell under a point, never the dragged view itself, and marks the hovered one', () => {
  const { frame, parent, view1 } = drawPreview()
  place(parent)
  view1.cell.rect = { bottom: 800, left: 110, right: 420, top: 310 }
  const at = (x: number, y: number, except?: string) =>
    StudioDrawLiveCells.at(parent as unknown as HTMLElement, { x, y }, except)
  Expect(at(200, 400)).toEqual({
    cellId: 'cell-1',
    source: { path: '/project/@/studio/View1.tao', version: 'version-View1' },
    view: 'View1',
  })
  Expect(at(200, 400, 'View1')).toBeUndefined()
  Expect(at(50, 400)).toBeUndefined()

  // A frame dragged over the cell names it; placement marks that cell, and clears it once the frame leaves.
  frame.dataset['taoStudioSketchDropInto'] = 'cell-1'
  place(parent)
  Expect(view1.cell.dataset['taoStudioDropIntoTarget']).toBe('true')
  delete frame.dataset['taoStudioSketchDropInto']
  place(parent)
  Expect(view1.cell.dataset['taoStudioDropIntoTarget']).toBeUndefined()
})
