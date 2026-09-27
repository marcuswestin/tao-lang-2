import { Describe, Expect, Test } from '@shared/test'
import { StudioInspection } from '../studio-src/client/app/StudioInspection'
import {
  inferGroupWrapper,
  studioSelectionAction,
  studioSelectionShortcut,
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
    selected.select(selection('/workspace/Other.tao', 1, 5), true)
    Expect(selected.selectedGroup().map(member => member.identity.path)).toEqual(['/workspace/Other.tao'])
    selected.select(title)
    selected.select(count)
    Expect(selected.selectedGroup().map(member => member.renderId)).toEqual([count.renderId])
    selected.clear()
    Expect(selected.selectedGroup()).toEqual([])
  })

  Test('⌘G makes a view and ⌥⌘G groups, never while composing or with shift', () => {
    const key = { altKey: false, code: 'KeyG', ctrlKey: false, isComposing: false, metaKey: true, shiftKey: false }
    Expect(studioSelectionShortcut(key)).toBe('make-view')
    Expect(studioSelectionShortcut({ ...key, altKey: true })).toBe('group')
    Expect(studioSelectionShortcut({ ...key, ctrlKey: true, metaKey: false })).toBe('make-view')
    Expect(studioSelectionShortcut({ ...key, metaKey: false })).toBeUndefined()
    Expect(studioSelectionShortcut({ ...key, shiftKey: true })).toBeUndefined()
    Expect(studioSelectionShortcut({ ...key, isComposing: true })).toBeUndefined()
    Expect(studioSelectionShortcut({ ...key, code: 'KeyH' })).toBeUndefined()
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
})
