import { Assert, Errors } from '@shared/core'
import type { StudioLayoutContentTerm, StudioLayoutEntry, StudioRenderInspection } from '@source-actions'
import { StudioInspector } from '../StudioInspector'
import {
  type StudioInspectorDraftMap,
  studioInspectorDraftMap,
  studioInspectorInspection,
  studioInspectorSelection,
} from './StudioInspectorModel'

const inspectorLayoutFieldIds = [
  'gap',
  'padding',
  'margin',
  'width-mode',
  'width-value',
  'max-width',
  'height-mode',
  'height-value',
  'growth-mode',
  'growth-value',
  'shrink',
  'alignment',
  'content',
] as const

const inspectorLayoutActionIds = [
  'gap',
  'padding',
  'margin',
  'width',
  'max-width',
  'height',
  'growth',
  'shrink',
  'alignment',
  'content',
  'wrap-stack',
] as const

const inspectorLayoutFieldLabels: Readonly<Record<string, string>> = {
  alignment: 'Self alignment',
  content: 'Content alignment',
  gap: 'Gap',
  'growth-mode': 'Growth mode',
  'growth-value': 'Claim weight',
  'height-mode': 'Height mode',
  'height-value': 'Height value',
  margin: 'Margin',
  'max-width': 'Max width',
  padding: 'Padding',
  shrink: 'Shrink',
  'width-mode': 'Width mode',
  'width-value': 'Width value',
}

const inspectorLayoutActionLabels: Readonly<Record<string, string>> = {
  alignment: 'Apply alignment',
  content: 'Apply content alignment',
  gap: 'Apply gap',
  growth: 'Apply growth',
  height: 'Apply height',
  margin: 'Apply margin',
  'max-width': 'Apply max width',
  padding: 'Apply padding',
  shrink: 'Apply shrink',
  width: 'Apply width',
  'wrap-stack': 'Wrap in Stack',
}

export function StudioInspectorLayoutDrafts(inspection: string): string {
  const parsed = studioInspectorInspection(inspection)
  if (parsed === undefined) {
    return '{}'
  }
  const model = StudioInspector.layout(parsed)
  return JSON.stringify({
    alignment: model.alignment.mode === 'aligned' ? model.alignment.value : model.alignment.mode,
    content: model.content?.join(' ') ?? '',
    gap: model.gap === undefined ? '' : String(model.gap),
    'growth-mode': model.growth.mode,
    'growth-value': model.growth.mode === 'claim' ? String(model.growth.value) : '',
    'height-mode': model.height.mode,
    'height-value': model.height.mode === 'fixed' ? String(model.height.value) : '',
    margin: model.margin?.[0] === 'margin' ? model.margin.slice(1).join(' ') : '',
    'max-width': model.widthCap === undefined ? '' : String(model.widthCap),
    padding: model.padding?.[0] === 'pad' ? model.padding.slice(1).join(' ') : '',
    shrink: model.shrink,
    'width-mode': model.width.mode,
    'width-value': model.width.mode === 'fixed' ? String(model.width.value) : '',
  })
}

export function StudioInspectorLayoutFieldIds(): string[] {
  return [...inspectorLayoutFieldIds]
}

export function StudioInspectorLayoutFieldLabel(fieldId: string): string {
  return inspectorLayoutFieldLabels[fieldId] ?? fieldId
}

export function StudioInspectorLayoutFieldUsesPicker(fieldId: string): boolean {
  return fieldId === 'alignment'
    || fieldId === 'growth-mode'
    || fieldId === 'height-mode'
    || fieldId === 'shrink'
    || fieldId === 'width-mode'
}

export function StudioInspectorLayoutFieldOptions(fieldId: string): string[] {
  if (fieldId === 'width-mode' || fieldId === 'height-mode') {
    return ['unset', 'fill', 'fixed']
  }
  if (fieldId === 'growth-mode') {
    return ['unset', 'fill', 'claim', 'hug']
  }
  if (fieldId === 'shrink') {
    return ['unset', 'compress', 'rigid']
  }
  if (fieldId === 'alignment') {
    return ['unset', 'fill', 'centered', 'baseline', 'bottom', 'center', 'left', 'right', 'top']
  }
  return []
}

export function StudioInspectorLayoutActionIds(): string[] {
  return [...inspectorLayoutActionIds]
}

export function StudioInspectorLayoutActionLabel(actionId: string): string {
  return inspectorLayoutActionLabels[actionId] ?? actionId
}

export function StudioInspectorLayoutActionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  drafts: string,
  busy: boolean,
  actionId: string,
): boolean {
  const parsedInspection = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  if (
    busy
    || parsedInspection === undefined
    || selected === undefined
    || parsedInspection.renderId !== selected.renderId
    || selected.identity.sourceVersion !== currentSourceVersion
  ) {
    return false
  }
  if (actionId === 'wrap-stack') {
    return true
  }
  return studioInspectorLayoutEntry(parsedInspection, studioInspectorDraftMap(drafts), actionId) !== undefined
}

export function StudioInspectorLayoutAction(
  inspection: string,
  selection: string,
  drafts: string,
  actionId: string,
): string {
  const parsedInspection = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  if (parsedInspection === undefined || selected === undefined || parsedInspection.renderId !== selected.renderId) {
    Errors.throwUserInput('Select a parsed rendered element before editing its layout.')
  }
  if (actionId === 'wrap-stack') {
    return JSON.stringify({ kind: 'wrap-render', renderId: selected.renderId, wrapper: 'Stack' })
  }
  const entry = studioInspectorLayoutEntry(parsedInspection, studioInspectorDraftMap(drafts), actionId)
  Assert.input(entry, `The ${StudioInspectorLayoutActionLabel(actionId)} draft is invalid.`)
  return JSON.stringify(StudioInspector.layoutAction(selected.renderId, entry))
}

function studioInspectorLayoutEntry(
  inspection: StudioRenderInspection,
  drafts: StudioInspectorDraftMap,
  actionId: string,
): StudioLayoutEntry | undefined {
  if (actionId === 'gap') {
    const value = StudioInspector.layoutSizeDraft(drafts['gap'] ?? '')
    return value === undefined ? undefined : ['gap', value]
  }
  if (actionId === 'padding' || actionId === 'margin') {
    return StudioInspector.spacingEntryDraft(actionId === 'padding' ? 'pad' : 'margin', drafts[actionId] ?? '')
  }
  if (actionId === 'width' || actionId === 'height') {
    const mode = drafts[`${actionId}-mode`]
    if (mode === 'fill') {
      return [actionId, 'fill']
    }
    const value = StudioInspector.layoutSizeDraft(drafts[`${actionId}-value`] ?? '')
    return mode === 'fixed' && value !== undefined ? [actionId, value] : undefined
  }
  if (actionId === 'max-width') {
    const value = StudioInspector.layoutSizeDraft(drafts['max-width'] ?? '')
    return value === undefined ? undefined : ['width', 'max', value]
  }
  if (actionId === 'growth') {
    const mode = drafts['growth-mode']
    if (mode === 'fill' || mode === 'hug') {
      return [mode]
    }
    const value = StudioInspector.positiveNumberDraft(drafts['growth-value'] ?? '')
    return mode === 'claim' && value !== undefined && StudioInspector.layout(inspection).shrink !== 'rigid'
      ? ['claim', value]
      : undefined
  }
  if (actionId === 'shrink') {
    const shrink = drafts['shrink']
    return (shrink === 'compress' || shrink === 'rigid')
        && !(shrink === 'rigid' && StudioInspector.layout(inspection).growth.mode === 'claim')
      ? [shrink]
      : undefined
  }
  if (actionId === 'alignment') {
    const alignment = drafts['alignment']
    if (alignment === 'fill' || alignment === 'centered') {
      return [alignment]
    }
    return alignment === 'baseline'
        || alignment === 'bottom'
        || alignment === 'center'
        || alignment === 'left'
        || alignment === 'right'
        || alignment === 'top'
      ? ['aligned', alignment]
      : undefined
  }
  if (actionId === 'content') {
    const terms = (drafts['content'] ?? '').trim().split(/\s+/).filter(Boolean) as StudioLayoutContentTerm[]
    return StudioInspector.contentEntry(terms)
  }
  return undefined
}
