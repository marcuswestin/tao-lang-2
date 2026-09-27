import { Switch } from '@shared/core'
import type { StudioSketch } from '../StudioSketchCatalog'

/** What a badge click asks for: render a chosen view, or detach a render into a definition. */
export type StudioSketchConvertIntent = Readonly<{ sketchId: string; to: 'definition' | 'render'; view?: string }>

export type StudioSketchBadgeRole = 'definition' | 'render'

/**
 * One line of a badge menu: a conversion to take, taking the rectangle off the canvas, or a note
 * saying why nothing else is offered. Removing a source-backed card changes only the sketch catalog;
 * removing a drawn definition also deletes the `@/studio` file Studio generated for it.
 */
export type StudioSketchBadgeItem =
  | Readonly<{ intent: StudioSketchConvertIntent; kind: 'action'; label: string }>
  | Readonly<{ kind: 'note'; label: string }>
  | Readonly<{ kind: 'remove'; label: string; sketchId: string }>

const removeFromCanvasLabel = 'Remove from canvas'
const removeLabel = 'Remove'

/** At most one sketch menu (a badge's or a right-click one) is open on the canvas; opening another closes it first. */
let openSketchMenuClose: (() => void) | undefined

/**
 * StudioSketchBadge marks every root rectangle on the Draw canvas as a definition (a view being
 * written) or a render (one call of a view that exists, kept as a scenario entry), and switches it.
 */
export const StudioSketchBadge = {
  role(sketch: Pick<StudioSketch, 'render'>): StudioSketchBadgeRole {
    return sketch.render === undefined ? 'definition' : 'render'
  },
  /** sourceBacked says the rectangle shows source that lives in code, not free rectangles to draw in. */
  sourceBacked(sketch: Pick<StudioSketch, 'definitionPath' | 'render'>): boolean {
    return sketch.render !== undefined || sketch.definitionPath !== undefined
  },
  /**
   * removalQuestion is what to ask before removing a rectangle, or nothing when removing it only
   * forgets a catalog entry. A drawn definition takes its generated file with it, so it is asked.
   */
  removalQuestion(sketch: Pick<StudioSketch, 'definitionPath' | 'render' | 'view'>): string | undefined {
    return StudioSketchBadge.sourceBacked(sketch)
      ? undefined
      : `Remove ${sketch.view} and delete @/studio/${sketch.view}.tao?`
  },
  items(
    sketch: Pick<StudioSketch, 'broken' | 'definitionPath' | 'id' | 'rects' | 'render' | 'snapped' | 'view'>,
    renderableViews: readonly string[],
  ): readonly StudioSketchBadgeItem[] {
    const remove: StudioSketchBadgeItem = { kind: 'remove', label: removeFromCanvasLabel, sketchId: sketch.id }
    if (sketch.render !== undefined && sketch.broken === true) {
      // Its scenario entry is gone, so there is nothing left to detach; the card can only leave.
      return [remove]
    }
    if (sketch.render !== undefined) {
      return [{
        intent: { sketchId: sketch.id, to: 'definition' },
        kind: 'action',
        label: `Detach into a new view, ${sketch.view}`,
      }, remove]
    }
    if (sketch.definitionPath !== undefined) {
      return [
        { kind: 'note', label: `${sketch.view} is written in ${sketch.definitionPath}; edit it there.` },
        remove,
      ]
    }
    return [...drawnItems(sketch, renderableViews), { kind: 'remove', label: removeLabel, sketchId: sketch.id }]
  },
  /**
   * element builds the badge button and its menu; picking a conversion hands its intent to `convert`,
   * and a remove item hands the sketch id to `remove`.
   */
  element(
    document: Document,
    sketch: StudioSketch,
    renderableViews: () => readonly string[],
    convert: (intent: StudioSketchConvertIntent) => void,
    remove: (sketchId: string) => void,
  ): HTMLElement {
    const role = StudioSketchBadge.role(sketch)
    const broken = role === 'render' && sketch.broken === true
    const wrapper = document.createElement('span')
    wrapper.className = 'studio-sketch-badge'
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['taoStudioSketchBadge'] = sketch.id
    button.dataset['role'] = role
    if (broken) {
      button.dataset['broken'] = 'true'
    }
    button.textContent = broken ? '▢ Broken render ▾' : role === 'render' ? '▢ Render ▾' : '◆ Definition ▾'
    button.title = broken
      ? 'This render’s scenario entry is gone'
      : role === 'render'
      ? 'A scenario entry rendering a view that already exists'
      : 'A view you are writing'
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    let close: (() => void) | undefined
    for (const type of ['pointerdown', 'pointerup']) {
      wrapper.addEventListener(type, event => event.stopPropagation())
    }
    button.addEventListener('click', event => {
      event.stopPropagation()
      if (close !== undefined) {
        close()
        return
      }
      const menu = document.createElement('div')
      menu.dataset['taoStudioSketchBadgeMenu'] = sketch.id
      close = openSketchMenu(document, wrapper, wrapper, menu, () => {
        close = undefined
        button.setAttribute('aria-expanded', 'false')
      })
      appendItems(document, menu, StudioSketchBadge.items(sketch, renderableViews()), close, convert, remove)
      button.setAttribute('aria-expanded', 'true')
    })
    wrapper.append(button)
    return wrapper
  },
  /**
   * contextMenu opens the right-click menu for one rectangle at `at`, in `frame`'s own coordinates.
   * It offers what every rectangle can do from anywhere on it: leave the canvas.
   */
  contextMenu(
    document: Document,
    frame: HTMLElement,
    sketch: Pick<StudioSketch, 'definitionPath' | 'id' | 'render'>,
    at: Readonly<{ x: number; y: number }>,
    remove: (sketchId: string) => void,
  ): () => void {
    const menu = document.createElement('div')
    menu.dataset['taoStudioSketchContextMenu'] = sketch.id
    menu.style.left = `${Math.round(at.x)}px`
    menu.style.top = `${Math.round(at.y)}px`
    for (const type of ['pointerdown', 'pointerup', 'contextmenu']) {
      menu.addEventListener(type, event => event.stopPropagation())
    }
    const close = openSketchMenu(document, frame, menu, menu, () => {})
    appendItems(document, menu, [{ kind: 'remove', label: removeLabel, sketchId: sketch.id }], close, () => {}, remove)
    return close
  },
  /** card shows a rectangle whose source lives in code: a render's entry, or a detached definition. */
  card(document: Document, sketch: StudioSketch, badge: HTMLElement): HTMLElement {
    const frame = document.createElement('section')
    frame.dataset['taoStudioSketchFrame'] = sketch.id
    frame.dataset['taoStudioSketchCard'] = StudioSketchBadge.role(sketch)
    frame.style.left = `${sketch.x}px`
    frame.style.position = 'absolute'
    frame.style.top = `${sketch.y}px`
    const name = document.createElement('span')
    name.dataset['taoStudioSketchName'] = sketch.id
    name.style.left = '0'
    name.style.position = 'absolute'
    name.style.top = '-22px'
    const label = document.createElement('span')
    label.textContent = sketch.render === undefined ? sketch.view : `${sketch.render.view}(…)`
    name.append(badge, label)
    const body = document.createElement('div')
    body.className = 'studio-sketch-card'
    body.dataset['taoStudioSketchCardBody'] = sketch.id
    body.style.height = `${sketch.height}px`
    body.style.width = `${sketch.width}px`
    const summary = document.createElement('code')
    const note = document.createElement('small')
    if (sketch.render === undefined) {
      summary.textContent = `view ${sketch.view}(…)`
      note.textContent = `Written in ${sketch.definitionPath}. Edit it in Design or the code pane.`
    } else if (sketch.broken === true) {
      // The code no longer holds the entry this card rendered; the card stays until it is removed.
      frame.dataset['taoStudioSketchBroken'] = 'true'
      summary.textContent = `render ${sketch.render.view}(…)`
      note.textContent =
        `Scenario “${sketch.render.scenario}” is gone from ${sketch.render.path}. Use Remove from canvas on its badge to clear this card.`
    } else {
      summary.textContent = `render ${sketch.render.view}(…)`
      note.textContent =
        `Scenario “${sketch.render.scenario}” in ${sketch.render.view} “${sketch.render.group}”, ${sketch.render.path}. To edit what it renders, open ${sketch.render.view}.`
    }
    body.append(summary, note)
    frame.append(name, body)
    return frame
  },
} as const

/** The conversions a drawn definition offers before its own Remove item. */
function drawnItems(
  sketch: Pick<StudioSketch, 'id' | 'rects' | 'snapped' | 'view'>,
  renderableViews: readonly string[],
): readonly StudioSketchBadgeItem[] {
  if (sketch.rects.length > 0 || sketch.snapped.length > 0) {
    return [{ kind: 'note', label: 'Clear the drawn rectangles to render an existing view here instead.' }]
  }
  const views = renderableViews.filter(view => view !== sketch.view)
  if (views.length === 0) {
    return [{ kind: 'note', label: 'No other view has a scenario to start a render from yet.' }]
  }
  return views.map(view => ({
    intent: { sketchId: sketch.id, to: 'render', view },
    kind: 'action',
    label: `Render ${view}`,
  }))
}

/**
 * openSketchMenu attaches `menu` to `parent` as the canvas's one open sketch menu and answers its
 * close. It closes on a press outside `inside`, on Escape anywhere, once a re-render detached
 * `inside`, or when another sketch menu opens.
 */
function openSketchMenu(
  document: Document,
  parent: HTMLElement,
  inside: HTMLElement,
  menu: HTMLElement,
  onClosed: () => void,
): () => void {
  openSketchMenuClose?.()
  let open = true
  const onDocumentPointerDown = (event: Event): void => {
    if (!inside.isConnected || !inside.contains(event.target as Node | null)) {
      close()
    }
  }
  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || !inside.isConnected) {
      close()
    }
  }
  const close = (): void => {
    if (!open) {
      return
    }
    open = false
    menu.remove()
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('keydown', onDocumentKeyDown, true)
    if (openSketchMenuClose === close) {
      openSketchMenuClose = undefined
    }
    onClosed()
  }
  menu.setAttribute('role', 'menu')
  parent.append(menu)
  // Capture phase, so canvas handlers that stop propagation cannot keep the menu open.
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onDocumentKeyDown, true)
  openSketchMenuClose = close
  return close
}

function appendItems(
  document: Document,
  menu: HTMLElement,
  items: readonly StudioSketchBadgeItem[],
  close: () => void,
  convert: (intent: StudioSketchConvertIntent) => void,
  remove: (sketchId: string) => void,
): void {
  const menuItem = (label: string, choose: () => void): HTMLElement => {
    const action = document.createElement('button')
    action.type = 'button'
    action.setAttribute('role', 'menuitem')
    action.textContent = label
    action.addEventListener('click', clicked => {
      clicked.stopPropagation()
      close()
      choose()
    })
    return action
  }
  for (const item of items) {
    menu.append(Switch.kind<StudioSketchBadgeItem, HTMLElement>(item, {
      action: chosen => menuItem(chosen.label, () => convert(chosen.intent)),
      note: chosen => {
        const note = document.createElement('p')
        note.textContent = chosen.label
        return note
      },
      remove: chosen => {
        const action = menuItem(chosen.label, () => remove(chosen.sketchId))
        action.dataset['taoStudioSketchRemove'] = chosen.sketchId
        return action
      },
    }))
  }
}
