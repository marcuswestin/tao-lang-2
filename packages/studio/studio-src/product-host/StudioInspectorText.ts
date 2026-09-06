import { Errors } from '@shared/core'
import type { StudioRenderInspection } from '@source-actions'
import {
  draftOwnerKey,
  studioInspectorDraftMap,
  studioInspectorInspection,
  studioInspectorSelection,
} from './StudioInspectorModel'

/** The Text section: edit a text leaf's literal or point it at a value visible where it renders. */
function studioInspectorText(inspection: string, selection: string): StudioRenderInspection['text'] {
  const selected = studioInspectorSelection(selection)
  const parsed = studioInspectorInspection(inspection)
  return selected !== undefined && parsed?.renderId === selected.renderId ? parsed.text : undefined
}

export function StudioInspectorTextAvailable(inspection: string, selection: string): boolean {
  return studioInspectorText(inspection, selection) !== undefined
}

export function StudioInspectorTextStatus(inspection: string, selection: string): string {
  const selected = studioInspectorSelection(selection)
  if (selected === undefined) {
    return 'Select a Text element to edit its content or bind it to a value.'
  }
  const text = studioInspectorText(inspection, selection)
  return text === undefined
    ? 'The selected element is not a Text leaf; select a Text or TextMultiline to edit its content.'
    : text.literal === undefined
    ? `Showing ${text.expression}.`
    : 'Showing a literal.'
}

export function StudioInspectorTextLiteral(inspection: string): string {
  return studioInspectorInspection(inspection)?.text?.literal ?? ''
}

export function StudioInspectorTextCandidates(inspection: string): string[] {
  return (studioInspectorInspection(inspection)?.text?.candidates ?? []).map(candidate => candidate.expression)
}

export function StudioInspectorTextBindingLabel(inspection: string, expression: string): string {
  const candidate = studioInspectorInspection(inspection)?.text?.candidates.find(entry =>
    entry.expression === expression
  )
  return candidate === undefined || candidate.type === 'text'
    ? `Bind to ${expression}`
    : `Bind to ${expression} (${candidate.type})`
}

export function StudioInspectorTextActionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  busy: boolean,
): boolean {
  const selected = studioInspectorSelection(selection)
  return !busy
    && selected !== undefined
    && selected.identity.sourceVersion === currentSourceVersion
    && studioInspectorText(inspection, selection) !== undefined
}

/** The Text section's draft: what was typed for this element, or the element's literal until then. */
export function StudioInspectorTextDraft(inspection: string, draft: string): string {
  const parsed = studioInspectorInspection(inspection)
  const current = studioInspectorDraftMap(draft)
  return parsed !== undefined && current[draftOwnerKey] === parsed.renderId
    ? current['value'] ?? ''
    : StudioInspectorTextLiteral(inspection)
}

export function StudioInspectorTextUpdateDraft(inspection: string, value: string): string {
  return JSON.stringify({ [draftOwnerKey]: studioInspectorInspection(inspection)?.renderId ?? '', value })
}

/**
 * A literal may be replaced with anything, including nothing. A bound leaf shows an empty draft,
 * and setting that would silently swap the binding for `Text("")`, so it waits for typed content.
 */
export function StudioInspectorSetTextValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  busy: boolean,
  draft: string,
): boolean {
  if (!StudioInspectorTextActionValid(currentSourceVersion, inspection, selection, busy)) {
    return false
  }
  return studioInspectorText(inspection, selection)?.literal !== undefined
    || StudioInspectorTextDraft(inspection, draft) !== ''
}

export function StudioInspectorSetTextAction(selection: string, content: string): string {
  const selected = studioInspectorSelection(selection)
  if (selected === undefined) {
    Errors.throwUserInput('Select a Text element before setting its content.')
  }
  return JSON.stringify({ content, kind: 'set-text-content', renderId: selected.renderId })
}

export function StudioInspectorBindTextAction(selection: string, expression: string): string {
  const selected = studioInspectorSelection(selection)
  if (selected === undefined) {
    Errors.throwUserInput('Select a Text element before binding it.')
  }
  return JSON.stringify({ expression, kind: 'bind-text', renderId: selected.renderId })
}
