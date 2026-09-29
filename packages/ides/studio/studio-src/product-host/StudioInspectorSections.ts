import { Errors } from '@shared/core'
import type { StudioMoveRenderRequest } from '@source-actions'
import { StudioInspectorLayoutDrafts } from './StudioInspectorLayout'
import {
  draftOwnerKey,
  studioInspectorDraftMap,
  studioInspectorInspection,
  StudioInspectorReady,
  studioInspectorSelection,
} from './StudioInspectorModel'
import { StudioInspectorStyleDrafts } from './StudioInspectorStyle'

/**
 * Drafts belong to the element they were typed for. A Tao view seeds its drafts state once, when
 * it mounts, so a draft map records the render it was seeded from and gives way to a fresh seed the
 * moment the inspected element changes; otherwise a gap typed for one element would be offered, and
 * applied, to the next one selected.
 */
export function StudioInspectorDraftsFor(section: string, inspection: string, drafts: string): string {
  const parsed = studioInspectorInspection(inspection)
  if (parsed !== undefined && studioInspectorDraftMap(drafts)[draftOwnerKey] === parsed.renderId) {
    return drafts
  }
  const seed = section === 'style' ? StudioInspectorStyleDrafts(inspection) : StudioInspectorLayoutDrafts(inspection)
  return parsed === undefined
    ? seed
    : JSON.stringify({ ...studioInspectorDraftMap(seed), [draftOwnerKey]: parsed.renderId })
}

export function StudioInspectorDataLines(
  inspection: string,
  selection: string,
  activeCellId: string,
  activeCellRevision: number,
  activeScenarioId: string,
): string[] {
  const selected = studioInspectorSelection(selection)
  const candidate = studioInspectorInspection(inspection)
  const parsed = selected !== undefined && candidate?.renderId === selected.renderId ? candidate : undefined
  if (selected === undefined) {
    return ['Select a rendered element to inspect its data context.']
  }
  return [
    `Selected view: ${selected.identity.occurrence?.renderOwner ?? 'not published'}`,
    `Selected element: ${parsed?.elementName ?? selected.identity.occurrence?.nodeKind ?? 'not published'}`,
    parsed?.text === undefined
      ? 'Binding metadata: not published for this render.'
      : `Text bindings: ${parsed.text.candidates.length} values in scope; bind one in the Text section.`,
    activeCellId === ''
      ? 'Datasource context: no active preview cell.'
      : `Datasource context: cell ${activeCellId} revision ${activeCellRevision}.`,
    activeScenarioId === '' ? 'Scenario context: none.' : `Scenario context: ${activeScenarioId}.`,
    'Entity tables are available in the Data panel.',
  ]
}

/** Inspector actions that act on the selected render as a whole; each lowers to one source action. */
const studioInspectorActions: Readonly<Record<string, Readonly<{ action: Record<string, unknown>; label: string }>>> = {
  'move-down': { action: { kind: 'move-render' }, label: 'Move down' },
  'move-up': { action: { kind: 'move-render' }, label: 'Move up' },
  'make-view': { action: { kind: 'extract-view' }, label: 'Make view' },
  'remove-element': { action: { kind: 'remove-render' }, label: 'Remove element' },
  'wrap-col': { action: { kind: 'wrap-render', wrapper: 'Col' }, label: 'Wrap in Col' },
  'wrap-row': { action: { kind: 'wrap-render', wrapper: 'Row' }, label: 'Wrap in Row' },
  'wrap-stack': { action: { kind: 'wrap-render', wrapper: 'Stack' }, label: 'Wrap in Stack' },
}

export function StudioInspectorActionIds(inspection: string, selection: string): string[] {
  return StudioInspectorReady(inspection, selection)
    ? ['move-up', 'move-down', 'wrap-row', 'wrap-col', 'wrap-stack', 'make-view', 'remove-element']
    : []
}

export function StudioInspectorActionLabel(actionId: string): string {
  return studioInspectorActions[actionId]?.label ?? actionId
}

export function StudioInspectorActionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  busy: boolean,
  actionId: string,
): boolean {
  const selected = studioInspectorSelection(selection)
  return studioInspectorActions[actionId] !== undefined
    && !busy
    && StudioInspectorReady(inspection, selection)
    && selected !== undefined
    && selected.identity.sourceVersion === currentSourceVersion
    && (!(actionId in studioInspectorMoves) || inspectorMove(inspection, actionId) !== undefined)
}

/** Move up and Move down step among the element's siblings, as the companion's menu does. */
const studioInspectorMoves: Readonly<Record<string, 'down' | 'up'>> = { 'move-down': 'down', 'move-up': 'up' }

/** The move the server offered for this direction; absent where the element is already at that end. */
function inspectorMove(inspection: string, actionId: string): StudioMoveRenderRequest | undefined {
  const direction = studioInspectorMoves[actionId]
  return direction === undefined ? undefined : studioInspectorInspection(inspection)?.moves[direction]
}

export function StudioInspectorAction(inspection: string, selection: string, actionId: string): string {
  const selected = studioInspectorSelection(selection)
  const definition = studioInspectorActions[actionId]
  if (selected === undefined || definition === undefined) {
    Errors.throwUserInput('The selected element does not expose that Studio action.')
  }
  if (actionId in studioInspectorMoves) {
    const move = inspectorMove(inspection, actionId)
    if (move === undefined || move.draggedId !== selected.renderId) {
      Errors.throwUserInput(
        `The selected element has nowhere to ${StudioInspectorActionLabel(actionId).toLowerCase()}.`,
      )
    }
    return JSON.stringify({ ...definition.action, ...move })
  }
  // Selection-wide actions take a list of renders; the inspector offers them for its one selection.
  return JSON.stringify(
    definition.action['kind'] === 'extract-view'
      ? { ...definition.action, renderIds: [selected.renderId] }
      : { ...definition.action, renderId: selected.renderId },
  )
}
