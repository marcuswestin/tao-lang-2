import { AfterAll, Expect, MockModule, Test, withTaoFiles } from '@shared/test'
import type { StudioSketchViewOptions } from '../studio-src/client/StudioSketchView'
import {
  type StudioSketch,
  StudioSketchCatalog,
  type StudioSketchCatalogRequest,
  type StudioSketchRect,
} from '../studio-src/StudioSketchCatalog'

const cover: StudioSketchRect = { height: 52, id: 'rect-cover', kind: 'Placeholder', width: 52, x: 12, y: 12 }
const title: StudioSketchRect = {
  content: 'Title',
  height: 20,
  id: 'rect-title',
  kind: 'Text',
  width: 200,
  x: 80,
  y: 12,
}

let catalog: StudioSketchCatalog | undefined
let sketchView: StudioSketchViewOptions | undefined
const restoreModules: (() => void)[] = []
AfterAll(() => {
  for (const restore of restoreModules.reverse()) {
    restore()
  }
})

async function mockClient(path: string, exports: (original: Record<string, unknown>) => object): Promise<void> {
  const url = new URL(`../studio-src/client/${path}.ts`, import.meta.url)
  const original = { ...await import(url.href) }
  restoreModules.push(() => MockModule(url.pathname, () => original))
  MockModule(url.pathname, () => ({ ...original, ...exports(original) }))
}

// The catalog behind the API is the real one on disk; only the HTTP hop and the DOM board are stubbed.
await mockClient('StudioApiClient', original => ({
  StudioApiClient: {
    ...original['StudioApiClient'] as object,
    sketchAction: (body: StudioSketchCatalogRequest) => catalog!.apply(body),
  },
}))
await mockClient('StudioSketchView', () => ({
  StudioSketchView: {
    mount: (_host: HTMLElement, options: StudioSketchViewOptions) => {
      sketchView = options
      return { dispose() {}, render() {} }
    },
  },
}))

function drawParent(): HTMLElement {
  const node = () =>
    Object.assign(new EventTarget(), {
      children: [],
      dataset: {} as Record<string, string>,
      querySelector: (_selector: string): unknown => null,
      toggleAttribute() {},
    })
  const parent = node()
  const draw = node()
  draw.querySelector = () => ({})
  parent.querySelector = selector => selector === ':scope > [data-tao-studio-draw-canvas]' ? draw : null
  return parent as unknown as HTMLElement
}

async function mutationsFor(publishes: string[]) {
  const { StudioSourceMutations } = await import('../studio-src/client/app/StudioSourceMutations')
  const status = { dataset: {} as Record<string, string | undefined>, textContent: '' } as unknown as HTMLElement
  const mutations = new StudioSourceMutations({
    activeFile: () => undefined,
    activePath: () => undefined,
    clearInspection() {},
    completeCompile() {},
    currentIdentity: () => undefined,
    editor: () => undefined,
    focusEditor() {},
    inspected: () => undefined,
    openFile: async () => undefined,
    project: '/music',
    publish: () => publishes.push('publish'),
    renderInspector() {},
    requireActiveDraftSaved: () => false,
    status,
  })
  return { mutations, status }
}

function geometry(sketch: StudioSketch | undefined) {
  return sketch === undefined
    ? undefined
    : { rectOrder: sketch.rectOrder, rects: sketch.rects, x: sketch.x, y: sketch.y }
}

Test('⌘Z walks Draw edits back one gesture at a time through the shared undo stack', async () => {
  await withTaoFiles('tao-studio-sketch-undo-', {}, async (_paths, root) => {
    catalog = new StudioSketchCatalog(root)
    const created = await catalog.apply({
      action: { height: 76, id: 'sketch-row', kind: 'create-sketch', project: 'music', rects: [cover], width: 360 },
      expectedRevision: 0,
      requestId: 'create-row',
    })
    const drawn = geometry(created.catalog.sketches[0])
    const { StudioMatrixSketches } = await import('../studio-src/client/matrix/StudioMatrixSketches')
    const parent = drawParent()
    StudioMatrixSketches.render(parent, '/music', created.catalog)
    const publishes: string[] = []
    const { mutations, status } = await mutationsFor(publishes)
    const disconnect = StudioMatrixSketches.connectEdits(parent, edit => mutations.recordSketchEdit(edit))
    const view = sketchView!
    const current = async () => geometry((await catalog!.read()).sketches[0])

    await view.onRectChange!({ kind: 'add', rect: title, sketchId: 'sketch-row' })
    const withTitle = await current()
    await view.onMove!({ sketchId: 'sketch-row', x: 300, y: 120 })
    const moved = await current()
    await view.onDeleteRects!('sketch-row', ['rect-cover', 'rect-title'])
    Expect(publishes).toHaveLength(3)
    // Only the newest edit offers Undo, even though no source file is open and no draft is saved.
    Expect(mutations.edits().map(edit => [edit.label, edit.path, edit.undoable])).toEqual([
      ['Delete 2 rectangles', 'View1', true],
      ['Move View1', 'View1', false],
      ['Draw Text', 'View1', false],
    ])
    Expect(mutations.canUndo()).toBe(true)

    await mutations.undoLatest()
    Expect(await current()).toEqual(moved)
    Expect(status.textContent).toBe('Undid Delete 2 rectangles.')
    await mutations.undoLatest()
    Expect(await current()).toEqual(withTitle)
    await mutations.undoLatest()
    Expect(await current()).toEqual(drawn)
    Expect(mutations.edits()).toEqual([])
    Expect(mutations.canUndo()).toBe(false)

    // A sketch changed behind an edit keeps that edit, and every earlier one of the sketch, as history.
    await view.onRectChange!({ kind: 'update', rect: { ...cover, x: 40 }, sketchId: 'sketch-row' })
    await view.onRectChange!({ kind: 'update', rect: { ...cover, height: 60, x: 40 }, sketchId: 'sketch-row' })
    const elsewhere = await catalog.apply({
      action: { id: 'sketch-row', kind: 'move-sketch', x: 8, y: 8 },
      expectedRevision: (await catalog.read()).revision,
      requestId: 'another-window',
    })
    StudioMatrixSketches.render(parent, '/music', elsewhere.catalog)
    await mutations.undoLatest()
    Expect(status.dataset['state']).toBe('error')
    Expect(status.textContent).toBe(
      'View1 changed after “Resize rectangle”, so its drawing edits can no longer be undone.',
    )
    Expect(await current()).toEqual(geometry(elsewhere.catalog.sketches[0]))
    Expect(mutations.edits().map(edit => [edit.label, edit.undoable])).toEqual([
      ['Resize rectangle', false],
      ['Move rectangle', false],
    ])
    Expect(mutations.canUndo()).toBe(false)

    disconnect()
    await view.onMove!({ sketchId: 'sketch-row', x: 20, y: 20 })
    Expect(mutations.edits()).toHaveLength(2)
  })
})

Test('Draw edits are named the way the person made them', async () => {
  const { StudioSketchUndo } = await import('../studio-src/client/matrix/StudioSketchUndo')
  const sketch = {
    height: 76,
    id: 'sketch-row',
    name: 'View1',
    project: 'music',
    rectOrder: ['rect-cover'],
    rects: [cover],
    snapped: [],
    view: 'View1',
    width: 360,
    x: 0,
    y: 0,
  } satisfies StudioSketch
  const update = (rect: StudioSketchRect) =>
    StudioSketchUndo.label([{ kind: 'update-rect', rect, rectId: rect.id, sketchId: sketch.id }], sketch)
  Expect(update({ ...cover, x: 30 })).toBe('Move rectangle')
  Expect(update({ ...cover, width: 80, x: 30 })).toBe('Resize rectangle')
  Expect(update({ ...cover, content: 'Cover' })).toBe('Edit text')
  Expect(update({ ...cover, kind: 'Image' })).toBe('Make Image')
  Expect(StudioSketchUndo.label([{ kind: 'delete-rect', rectId: 'rect-cover', sketchId: sketch.id }], sketch))
    .toBe('Delete rectangle')
  Expect(
    StudioSketchUndo.label([{
      id: 'copy',
      kind: 'duplicate-rect',
      rectId: 'rect-cover',
      sketchId: sketch.id,
      x: 1,
      y: 1,
    }], sketch),
  ).toBe('Duplicate rectangle')
  // Anything that writes source keeps its own undo path.
  Expect(StudioSketchUndo.label([{ id: sketch.id, kind: 'delete-sketch' }], sketch)).toBeUndefined()
  Expect(StudioSketchUndo.label([], sketch)).toBeUndefined()
})
