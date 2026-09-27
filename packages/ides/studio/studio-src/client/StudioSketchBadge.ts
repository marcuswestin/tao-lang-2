import type { StudioSketch } from '../StudioSketchCatalog'

/** What a badge click asks for: render a chosen view, or detach a render into a definition. */
export type StudioSketchConvertIntent = Readonly<{ sketchId: string; to: 'definition' | 'render'; view?: string }>

export type StudioSketchBadgeRole = 'definition' | 'render'

/** One line of a badge menu: an action to take, or a note saying why none is offered. */
export type StudioSketchBadgeItem =
  | Readonly<{ intent: StudioSketchConvertIntent; kind: 'action'; label: string }>
  | Readonly<{ kind: 'note'; label: string }>

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
  items(
    sketch: Pick<StudioSketch, 'definitionPath' | 'id' | 'rects' | 'render' | 'snapped' | 'view'>,
    renderableViews: readonly string[],
  ): readonly StudioSketchBadgeItem[] {
    if (sketch.render !== undefined) {
      return [{
        intent: { sketchId: sketch.id, to: 'definition' },
        kind: 'action',
        label: `Detach into a new view, ${sketch.view}`,
      }]
    }
    if (sketch.definitionPath !== undefined) {
      return [{ kind: 'note', label: `${sketch.view} is written in ${sketch.definitionPath}; edit it there.` }]
    }
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
  },
  /** element builds the badge button and its menu; picking an action hands its intent to `convert`. */
  element(
    document: Document,
    sketch: StudioSketch,
    renderableViews: () => readonly string[],
    convert: (intent: StudioSketchConvertIntent) => void,
  ): HTMLElement {
    const role = StudioSketchBadge.role(sketch)
    const wrapper = document.createElement('span')
    wrapper.className = 'studio-sketch-badge'
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['taoStudioSketchBadge'] = sketch.id
    button.dataset['role'] = role
    button.textContent = role === 'render' ? '▢ Render ▾' : '◆ Definition ▾'
    button.title = role === 'render'
      ? 'A scenario entry rendering a view that already exists'
      : 'A view you are writing'
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    const close = (): void => {
      wrapper.querySelector(':scope > [data-tao-studio-sketch-badge-menu]')?.remove()
      button.setAttribute('aria-expanded', 'false')
    }
    for (const type of ['pointerdown', 'pointerup']) {
      wrapper.addEventListener(type, event => event.stopPropagation())
    }
    button.addEventListener('click', event => {
      event.stopPropagation()
      if (wrapper.querySelector(':scope > [data-tao-studio-sketch-badge-menu]') !== null) {
        close()
        return
      }
      const menu = document.createElement('div')
      menu.dataset['taoStudioSketchBadgeMenu'] = sketch.id
      menu.setAttribute('role', 'menu')
      for (const item of StudioSketchBadge.items(sketch, renderableViews())) {
        if (item.kind === 'note') {
          const note = document.createElement('p')
          note.textContent = item.label
          menu.append(note)
          continue
        }
        const action = document.createElement('button')
        action.type = 'button'
        action.setAttribute('role', 'menuitem')
        action.textContent = item.label
        action.addEventListener('click', clicked => {
          clicked.stopPropagation()
          close()
          convert(item.intent)
        })
        menu.append(action)
      }
      wrapper.append(menu)
      button.setAttribute('aria-expanded', 'true')
    })
    wrapper.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        close()
      }
    })
    wrapper.append(button)
    return wrapper
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
    body.style.height = `${sketch.height}px`
    body.style.width = `${sketch.width}px`
    const summary = document.createElement('code')
    const note = document.createElement('small')
    if (sketch.render === undefined) {
      summary.textContent = `view ${sketch.view}(…)`
      note.textContent = `Written in ${sketch.definitionPath}. Edit it in Design or the code pane.`
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
