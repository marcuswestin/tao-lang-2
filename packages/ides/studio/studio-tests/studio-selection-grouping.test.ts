import { Describe, Expect, Test } from '@shared/test'
import {
  isStudioVisualUndoShortcut,
  mountStudioEditLog,
  studioEditAge,
  studioEditLabel,
} from '../studio-src/client/app/StudioEditLog'
import { StudioInspection } from '../studio-src/client/app/StudioInspection'
import {
  inferGroupWrapper,
  studioCanvasCommandAllowed,
  studioCanvasKeyCommand,
  studioSelectionAction,
  studioSelectionShortcut,
  studioViewNameAnswer,
} from '../studio-src/client/app/StudioSelectionGrouping'
import type { StudioClientView } from '../studio-src/client/StudioShell'
import { StudioInspector } from '../studio-src/StudioInspector'
import { studioProtocolChannel, studioProtocolVersion } from '../studio-src/StudioProtocol'

function selection(path: string, start: number, end: number) {
  return StudioInspector.selection({
    channel: studioProtocolChannel,
    identity: {
      appName: 'Garden',
      occurrence: { nodeKind: 'render', renderOwner: 'Main' },
      path,
      previewInstanceId: 'preview-1',
      project: '/workspace',
      sourceVersion: 'source-1',
    },
    protocolVersion: studioProtocolVersion,
    range: { end, start },
    type: 'preview-select-source',
  })
}

function inspection(): StudioInspection {
  // Selecting never renders, so the view is never reached.
  return new StudioInspection({
    active: () => undefined,
    project: '/workspace',
    publish: () => {},
    view: {} as StudioClientView,
  })
}

const garden = '/workspace/Garden.tao'

Describe('Studio selection grouping', () => {
  Test('Make view takes a typed name, numbers the view for an empty answer, and makes nothing on Cancel', () => {
    Expect(studioViewNameAnswer('  StoryCard ')).toEqual({ name: 'StoryCard' })
    Expect(studioViewNameAnswer('   ')).toEqual({})
    Expect(studioViewNameAnswer(undefined)).toBeUndefined()
  })

  Test('additive selection toggles members of one file and keeps the last added as the selection', () => {
    const selected = inspection()
    const title = selection(garden, 10, 20)
    const count = selection(garden, 30, 40)
    selected.select(title)
    selected.select(count, true)
    Expect(selected.selectedGroup().map(member => member.renderId)).toEqual([title.renderId, count.renderId])
    Expect(selected.selected()?.renderId).toBe(count.renderId)
    selected.select(count, true)
    Expect(selected.selectedGroup().map(member => member.renderId)).toEqual([title.renderId])
    Expect(selected.selected()?.renderId).toBe(title.renderId)
    selected.select(title, true)
    Expect(selected.selectedGroup()).toHaveLength(1)
    Expect(selected.select(selection('/workspace/Other.tao', 1, 5), true)).toBe(false)
    Expect(selected.selectedGroup().map(member => member.identity.path)).toEqual(['/workspace/Other.tao'])
    Expect(selected.select(title)).toBe(false)
    Expect(selected.select(count)).toBe(false)
    Expect(selected.selectedGroup().map(member => member.renderId)).toEqual([count.renderId])
    selected.clear()
    Expect(selected.selectedGroup()).toEqual([])
  })

  Test('a shift-click in another preview cell starts a fresh selection there', () => {
    const selected = inspection()
    const title = selection(garden, 10, 20)
    const count = selection(garden, 30, 40)
    const otherCell = { ...count, identity: { ...count.identity, previewInstanceId: 'preview-2' } }
    Expect(selected.select(title)).toBe(false)
    Expect(selected.select(otherCell, true)).toBe(false)
    Expect(selected.selectedGroup()).toEqual([otherCell])
    Expect(selected.select(title, true)).toBe(false)
    Expect(selected.selectedGroup()).toEqual([title])
    Expect(selected.select(count, true)).toBe(true)
    Expect(selected.selectedGroup().map(member => member.renderId)).toEqual([title.renderId, count.renderId])
  })

  Test('⌘G makes a view and ⌥⌘G groups, never while composing or with shift', () => {
    const key = {
      altKey: false,
      code: 'KeyG',
      ctrlKey: false,
      isComposing: false,
      key: 'g',
      metaKey: true,
      shiftKey: false,
    }
    Expect(studioSelectionShortcut(key)).toBe('make-view')
    Expect(studioSelectionShortcut({ ...key, altKey: true, key: '©' })).toBe('group')
    Expect(studioSelectionShortcut({ ...key, ctrlKey: true, metaKey: false })).toBe('make-view')
    Expect(studioSelectionShortcut({ ...key, metaKey: false })).toBeUndefined()
    Expect(studioSelectionShortcut({ ...key, shiftKey: true })).toBeUndefined()
    Expect(studioSelectionShortcut({ ...key, isComposing: true })).toBeUndefined()
    Expect(studioSelectionShortcut({ ...key, key: 'h' })).toBeUndefined()
    // The letter follows the layout: on Dvorak the physical KeyG types "i", and "g" sits on KeyU.
    Expect(studioSelectionShortcut({ ...key, key: 'i' })).toBeUndefined()
    Expect(studioSelectionShortcut({ ...key, code: 'KeyU' })).toBe('make-view')
    Expect(studioSelectionShortcut({ ...key, key: 'G' })).toBe('make-view')
    // ⌥ turns the key into a symbol, so only then does the physical key decide.
    Expect(studioSelectionShortcut({ ...key, altKey: true, code: 'KeyH', key: '˙' })).toBeUndefined()
  })

  Test('canvas keys stay out of typing targets and act only in the presets that show their target', () => {
    const undo = {
      altKey: false,
      code: 'KeyZ',
      ctrlKey: false,
      isComposing: false,
      key: 'z',
      metaKey: true,
      shiftKey: false,
    }
    const makeView = { ...undo, code: 'KeyG', key: 'g' }
    const group = { ...makeView, altKey: true, key: '©' }
    const context = { canUndo: true, hasSelection: true, preset: 'design', typing: false }
    Expect(studioCanvasKeyCommand(undo, context)).toBe('undo')
    Expect(studioCanvasKeyCommand(makeView, context)).toBe('make-view')
    Expect(studioCanvasKeyCommand(group, context)).toBe('group')
    // The code editor and text fields keep their own ⌘Z and ⌘G.
    for (const event of [undo, makeView, group]) {
      Expect(studioCanvasKeyCommand(event, { ...context, typing: true })).toBeUndefined()
    }
    // Draw walks back the edit log but has no preview selection to group; Code and Run have neither.
    Expect(studioCanvasKeyCommand(undo, { ...context, preset: 'draw' })).toBe('undo')
    Expect(studioCanvasKeyCommand(makeView, { ...context, preset: 'draw' })).toBeUndefined()
    for (const preset of ['code', 'run', undefined]) {
      Expect(studioCanvasKeyCommand(undo, { ...context, preset })).toBeUndefined()
      Expect(studioCanvasKeyCommand(group, { ...context, preset })).toBeUndefined()
    }
    Expect(studioCanvasKeyCommand(undo, { ...context, canUndo: false })).toBeUndefined()
    Expect(studioCanvasKeyCommand(makeView, { ...context, hasSelection: false })).toBeUndefined()
    // ⌥⌘Z is not undo, and falls through to nothing rather than to a selection command.
    Expect(studioCanvasKeyCommand({ ...undo, altKey: true, key: 'Ω' }, context)).toBeUndefined()
    Expect(studioCanvasCommandAllowed('undo', 'draw')).toBe(true)
    Expect(studioCanvasCommandAllowed('group', 'draw')).toBe(false)
    Expect(studioCanvasCommandAllowed('make-view', 'design')).toBe(true)
  })

  Test('grouping picks Row for elements laid out across and Col otherwise', () => {
    const box = (left: number, top: number) => ({ bottom: top + 20, left, right: left + 40, top })
    Expect(inferGroupWrapper([box(0, 0), box(60, 4)])).toBe('Row')
    Expect(inferGroupWrapper([box(0, 0), box(4, 40)])).toBe('Col')
    Expect(inferGroupWrapper([box(0, 0), undefined])).toBe('Col')
    const group = [selection(garden, 10, 20), selection(garden, 30, 40)]
    const bounds = new Map(group.map((member, index) => [member.renderId, box(index * 60, 0)]))
    Expect(studioSelectionAction('group', group, member => bounds.get(member.renderId))).toEqual({
      kind: 'group-renders',
      renderIds: [`${garden}:10:20`, `${garden}:30:40`],
      wrapper: 'Row',
    })
    Expect(studioSelectionAction('make-view', group, () => undefined)).toEqual({
      kind: 'extract-view',
      renderIds: [`${garden}:10:20`, `${garden}:30:40`],
    })
  })

  Test('the edit log names edits the way they were made and ages them coarsely', () => {
    Expect(studioEditLabel({ entry: ['gap', 16], kind: 'set-layout-entry', renderId: 'x' })).toBe('Gap 16')
    Expect(studioEditLabel({ kind: 'group-renders', renderIds: [], wrapper: 'Row' })).toBe('Group in Row')
    Expect(studioEditLabel({ kind: 'extract-view', renderIds: [] })).toBe('Make view')
    Expect(studioEditLabel({ kind: 'extract-view', name: 'Card', renderIds: [] })).toBe('Make view Card')
    Expect(studioEditLabel({ kind: 'insert-spacer' })).toBe('Insert spacer')
    Expect(studioEditLabel({ kind: 'toString' })).toBe('ToString')
    const minute = 60_000
    Expect([0, 59_000, minute, 59 * minute, 60 * minute, 49 * 60 * minute].map(age => studioEditAge(0, age)))
      .toEqual(['now', 'now', '1m', '59m', '1h', '2d'])
    const key = {
      altKey: false,
      code: 'KeyZ',
      ctrlKey: false,
      isComposing: false,
      key: 'z',
      metaKey: true,
      shiftKey: false,
    }
    Expect(isStudioVisualUndoShortcut(key)).toBe(true)
    Expect(isStudioVisualUndoShortcut({ ...key, shiftKey: true })).toBe(false)
    Expect(isStudioVisualUndoShortcut({ ...key, metaKey: false })).toBe(false)
    // On a German layout the physical KeyY types "z", and that is the key people mean by ⌘Z.
    Expect(isStudioVisualUndoShortcut({ ...key, code: 'KeyY' })).toBe(true)
    Expect(isStudioVisualUndoShortcut({ ...key, key: 'y' })).toBe(false)
  })

  Test('the edit log rebuilds only when its rows or their shown ages change', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
    type Node = { append: (...children: Node[]) => void; replaceChildren: (...children: Node[]) => void }
    let rebuilds = 0
    const element = (): Node & Record<string, unknown> => {
      const node: Node & Record<string, unknown> = {
        addEventListener() {},
        append(...children: Node[]) {
          for (const child of children) {
            ;(child as Record<string, unknown>)['parentElement'] = node
          }
        },
        dataset: {},
        remove() {},
        replaceChildren() {
          rebuilds += 1
        },
        setAttribute() {},
      }
      return node
    }
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: element },
      writable: true,
    })
    try {
      let clock = 0
      let edits = [{ at: 0, id: 'checkpoint-1', label: 'Gap 16', path: 'Garden.tao', undoable: true }]
      const log = mountStudioEditLog({
        edits: () => edits,
        host: element() as unknown as HTMLElement,
        now: () => clock,
        undo() {},
      })
      Expect(rebuilds).toBe(1)
      log.render()
      clock = 30_000
      log.render()
      Expect(rebuilds).toBe(1)
      clock = 60_000
      log.render()
      Expect(rebuilds).toBe(2)
      edits = [{ ...edits[0]!, undoable: false }]
      log.render()
      Expect(rebuilds).toBe(3)
      log.dispose()
    } finally {
      if (previous === undefined) {
        delete (globalThis as { document?: unknown }).document
      } else {
        Object.defineProperty(globalThis, 'document', previous)
      }
    }
  })
})
