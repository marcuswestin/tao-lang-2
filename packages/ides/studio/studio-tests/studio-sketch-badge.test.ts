import { Expect, Test } from '@shared/test'
import { StudioMatrixSketches } from '../studio-src/client/matrix/StudioMatrixSketches'
import { StudioSketchBadge } from '../studio-src/client/StudioSketchBadge'
import type { StudioSketch, StudioSketchCatalogSnapshot } from '../studio-src/StudioSketchCatalog'

const drawn: Pick<StudioSketch, 'broken' | 'definitionPath' | 'id' | 'rects' | 'render' | 'snapped' | 'view'> = {
  id: 'sketch-1',
  rects: [],
  snapped: [],
  view: 'View1',
}

Test('Studio sketch badge offers every other renderable view to an empty drawn rectangle', () => {
  Expect(StudioSketchBadge.role(drawn)).toBe('definition')
  Expect(StudioSketchBadge.sourceBacked(drawn)).toBe(false)
  Expect(StudioSketchBadge.items(drawn, ['StoryRow', 'View1', 'CommentRow'])).toEqual([
    { intent: { sketchId: 'sketch-1', to: 'render', view: 'StoryRow' }, kind: 'action', label: 'Render StoryRow' },
    { intent: { sketchId: 'sketch-1', to: 'render', view: 'CommentRow' }, kind: 'action', label: 'Render CommentRow' },
  ])
  Expect(StudioSketchBadge.items(drawn, ['View1'])).toEqual([
    { kind: 'note', label: 'No other view has a scenario to start a render from yet.' },
  ])
})

Test('Studio sketch badge says why a drawn or written definition cannot switch to a render', () => {
  const withRects = { ...drawn, rects: [{ height: 10, id: 'r', kind: 'Text' as const, width: 10, x: 0, y: 0 }] }
  Expect(StudioSketchBadge.items(withRects, ['StoryRow'])).toEqual([
    { kind: 'note', label: 'Clear the drawn rectangles to render an existing view here instead.' },
  ])
  const written = { ...drawn, definitionPath: 'Rows.tao' }
  Expect(StudioSketchBadge.sourceBacked(written)).toBe(true)
  Expect(StudioSketchBadge.items(written, ['StoryRow'])).toEqual([
    { kind: 'note', label: 'View1 is written in Rows.tao; edit it there.' },
    { kind: 'remove', label: 'Remove from canvas', sketchId: 'sketch-1' },
  ])
})

Test('Studio sketch badge detaches a render into the view the rectangle already names', () => {
  const render = {
    ...drawn,
    render: { group: 'rows', path: 'Rows.scenarios.tao', scenario: 'drawn1', view: 'StoryRow' },
  }
  Expect(StudioSketchBadge.role(render)).toBe('render')
  Expect(StudioSketchBadge.items(render, ['StoryRow'])).toEqual([
    { intent: { sketchId: 'sketch-1', to: 'definition' }, kind: 'action', label: 'Detach into a new view, View1' },
    { kind: 'remove', label: 'Remove from canvas', sketchId: 'sketch-1' },
  ])
  // A render whose scenario entry is gone has nothing left to detach; it can only leave the canvas.
  Expect(StudioSketchBadge.items({ ...render, broken: true }, ['StoryRow'])).toEqual([
    { kind: 'remove', label: 'Remove from canvas', sketchId: 'sketch-1' },
  ])
})

Test('Studio shows a broken render card and removes it from the canvas through its badge', () => {
  const dom = fakeBadgeDocument()
  const broken = {
    ...drawn,
    broken: true,
    height: 100,
    name: 'sketch-1',
    project: 'p',
    rectOrder: [],
    render: { group: 'rows', path: 'Rows.scenarios.tao', scenario: 'drawn1', view: 'StoryRow' },
    width: 100,
    x: 0,
    y: 0,
  } as StudioSketch
  const removed: string[] = []
  const converted: unknown[] = []
  const badge = StudioSketchBadge.element(
    dom.document,
    broken,
    () => ['StoryRow'],
    intent => converted.push(intent),
    sketchId => removed.push(sketchId),
  )
  const card = StudioSketchBadge.card(dom.document, broken, badge) as unknown as FakeNode
  dom.body.append(card)
  Expect(card.dataset['taoStudioSketchBroken']).toBe('true')
  Expect(card.children[1]!.children.map(child => child.textContent)).toEqual([
    'render StoryRow(…)',
    'Scenario “drawn1” is gone from Rows.scenarios.tao. Use Remove from canvas on its badge to clear this card.',
  ])
  const button = (badge as unknown as FakeNode).children.find(child => child.tagName === 'button')!
  Expect(button.dataset['broken']).toBe('true')
  Expect(button.textContent).toBe('▢ Broken render ▾')

  button.fire('click', {})
  const menu = (badge as unknown as FakeNode).children.find(child => child.dataset['taoStudioSketchBadgeMenu'])!
  Expect(menu.children.map(child => child.textContent)).toEqual(['Remove from canvas'])
  menu.children[0]!.fire('click', {})
  Expect(removed).toEqual(['sketch-1'])
  Expect(converted).toEqual([])
  Expect(dom.listenerCount()).toBe(0)
})

Test('Studio re-reads the sketch catalog after a manifest update so broken marks show', async () => {
  const brokenCatalog = {
    formatVersion: 1,
    nextViewNumber: 2,
    revision: 7,
    sketches: [{ ...drawn, broken: true }],
  } as unknown as StudioSketchCatalogSnapshot
  const parent = {} as HTMLElement
  const rendered: unknown[] = []
  let reads = 0
  await StudioMatrixSketches.refresh(parent, '/workspace', async () => {
    reads += 1
    return brokenCatalog
  }, (host, project, catalog) => rendered.push([host, project, catalog]))
  Expect(reads).toBe(1)
  Expect(rendered).toEqual([[parent, '/workspace', brokenCatalog]])
})

Test('Studio sketch badge menu closes on an outside press, on Escape anywhere, and when another opens', () => {
  const dom = fakeBadgeDocument()
  const sketch = (id: string) =>
    ({ ...drawn, height: 100, id, name: id, project: 'p', rectOrder: [], width: 100, x: 0, y: 0 }) as StudioSketch
  const converted: unknown[] = []
  const first = StudioSketchBadge.element(
    dom.document,
    sketch('a'),
    () => ['StoryRow'],
    intent => converted.push(intent),
    () => {},
  )
  const second = StudioSketchBadge.element(
    dom.document,
    sketch('b'),
    () => ['StoryRow'],
    intent => converted.push(intent),
    () => {},
  )
  const canvas = dom.document.createElement('div')
  canvas.append(first, second)
  dom.body.append(canvas as unknown as FakeNode)
  const menuOf = (badge: HTMLElement) =>
    (badge as unknown as FakeNode).children.find(child => child.dataset['taoStudioSketchBadgeMenu'] !== undefined)
  const buttonOf = (badge: HTMLElement) =>
    (badge as unknown as FakeNode).children.find(child => child.tagName === 'button')!

  buttonOf(first).fire('click', {})
  Expect(menuOf(first)).toBeDefined()
  Expect(dom.listenerCount()).toBe(2)
  // A press inside the badge keeps it open; one anywhere else closes it and drops the document listeners.
  dom.fire('pointerdown', { target: menuOf(first) })
  Expect(menuOf(first)).toBeDefined()
  dom.fire('pointerdown', { target: canvas })
  Expect(menuOf(first)).toBeUndefined()
  Expect(buttonOf(first).attributes.get('aria-expanded')).toBe('false')
  Expect(dom.listenerCount()).toBe(0)

  buttonOf(first).fire('click', {})
  dom.fire('keydown', { key: 'Escape', target: canvas })
  Expect(menuOf(first)).toBeUndefined()
  Expect(dom.listenerCount()).toBe(0)

  buttonOf(first).fire('click', {})
  buttonOf(second).fire('click', {})
  Expect(menuOf(first)).toBeUndefined()
  Expect(menuOf(second)).toBeDefined()
  Expect(dom.listenerCount()).toBe(2)

  // A re-render that detached the badge closes its menu on the next document event.
  const detached = second as unknown as FakeNode
  detached.remove()
  dom.fire('keydown', { key: 'a', target: canvas })
  Expect(menuOf(second)).toBeUndefined()
  Expect(dom.listenerCount()).toBe(0)

  buttonOf(first).fire('click', {})
  menuOf(first)!.children[0]!.fire('click', {})
  Expect(converted).toEqual([{ sketchId: 'a', to: 'render', view: 'StoryRow' }])
  Expect(menuOf(first)).toBeUndefined()
  Expect(dom.listenerCount()).toBe(0)
})

type FakeListener = (event: Record<string, unknown>) => void

/** Client tests run without a DOM library, so the badge is exercised against a small stand-in. */
class FakeNode {
  readonly attributes = new Map<string, string>()
  children: FakeNode[] = []
  className = ''
  readonly dataset: Record<string, string | undefined> = {}
  readonly listeners = new Map<string, Set<FakeListener>>()
  parent: FakeNode | undefined
  readonly style: Record<string, string> = {}
  textContent = ''
  title = ''
  type = ''

  constructor(readonly tagName: string, readonly root = false) {}

  get isConnected(): boolean {
    return this.root || this.parent?.isConnected === true
  }

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener))
  }

  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }

  contains(node: unknown): boolean {
    return node === this || this.children.some(child => child.contains(node))
  }

  fire(type: string, event: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ stopPropagation() {}, ...event })
    }
  }

  remove(): void {
    if (this.parent !== undefined) {
      this.parent.children = this.parent.children.filter(child => child !== this)
      this.parent = undefined
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

function fakeBadgeDocument(): {
  body: FakeNode
  document: Document
  fire: (type: string, event: Record<string, unknown>) => void
  listenerCount: () => number
} {
  const body = new FakeNode('body', true)
  const listeners = new Map<string, Set<FakeListener>>()
  const document = {
    addEventListener(type: string, listener: FakeListener) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
    },
    createElement: (tag: string) => new FakeNode(tag),
    removeEventListener(type: string, listener: FakeListener) {
      listeners.get(type)?.delete(listener)
    },
  }
  return {
    body,
    document: document as unknown as Document,
    fire(type, event) {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener(event)
      }
    },
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
  }
}
