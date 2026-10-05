import { Errors } from '@shared/core'
import { studioRenderActionIds, StudioRenderActions } from '../StudioRenderActions'
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
  focusedCellId: string,
  focusedCellRevision: number,
  focusedScenarioId: string,
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
    focusedCellId === ''
      ? 'Datasource context: no focused preview cell.'
      : `Datasource context: cell ${focusedCellId} revision ${focusedCellRevision}.`,
    focusedScenarioId === '' ? 'Scenario context: none.' : `Scenario context: ${focusedScenarioId}.`,
    'Entity tables are available in the Data panel.',
  ]
}

export function StudioInspectorActionIds(inspection: string, selection: string): string[] {
  return StudioInspectorReady(inspection, selection) ? [...studioRenderActionIds] : []
}

export function StudioInspectorActionLabel(actionId: string): string {
  return StudioRenderActions.label(actionId)
}

export function StudioInspectorActionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  busy: boolean,
  actionId: string,
): boolean {
  const selected = studioInspectorSelection(selection)
  const parsed = studioInspectorInspection(inspection)
  return !busy
    && StudioInspectorReady(inspection, selection)
    && selected !== undefined
    && selected.identity.sourceVersion === currentSourceVersion
    && parsed !== undefined
    && StudioRenderActions.action(parsed, actionId) !== undefined
}

export function StudioInspectorAction(inspection: string, selection: string, actionId: string): string {
  const parsed = studioInspectorInspection(inspection)
  const action = parsed === undefined || !StudioInspectorReady(inspection, selection)
    ? undefined
    : StudioRenderActions.action(parsed, actionId)
  if (action === undefined) {
    Errors.throwUserInput(
      StudioRenderActions.isMove(actionId)
        ? `The selected element has nowhere to ${StudioRenderActions.label(actionId).toLowerCase()}.`
        : 'The selected element does not expose that Studio action.',
    )
  }
  return JSON.stringify(action)
}
