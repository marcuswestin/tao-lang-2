import type { StudioRenderInspection } from '@source-actions'
import { projectRelativePath } from '../client/StudioEditor'
import type { StudioInspectorSelection } from '../StudioInspector'
import { parseStudioJson } from './StudioHostJson'

export type StudioInspectorDraftMap = Readonly<Record<string, string>>

/** The draft-map key naming the render a set of inspector drafts was typed for. */
export const draftOwnerKey = '$for'

export function StudioInspectorReady(inspection: string, selection: string): boolean {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  return parsed !== undefined && selected !== undefined && parsed.renderId === selected.renderId
}

export function StudioInspectorStatus(inspection: string, selection: string): string {
  return studioInspectorSelection(selection) === undefined
    ? 'Select a rendered element in the preview.'
    : studioInspectorInspection(inspection) === undefined
    ? 'Reading parsed render values…'
    : ''
}

/**
 * The selection summary in words a person uses: the file and lines, the owning view, the element,
 * and whether the preview that produced it is current. Byte ranges and render ids stay internal.
 */
export function StudioInspectorSummaryLines(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  activeContent = '',
  activePath = '',
): string[] {
  const selected = studioInspectorSelection(selection)
  if (selected === undefined) {
    return ['Select a rendered element in the preview.']
  }
  const candidate = studioInspectorInspection(inspection)
  const parsed = candidate?.renderId === selected.renderId ? candidate : undefined
  const occurrence = selected.identity.occurrence
  const path = projectRelativePath(selected.identity.project, selected.identity.path) ?? selected.identity.path
  const lines = path === activePath && selected.identity.sourceVersion === currentSourceVersion
    ? sourceLineRange(activeContent, selected.range)
    : ''
  return [
    `Source: ${path}${lines}`,
    ...(selected.identity.sourceVersion === currentSourceVersion ? [] : ['Waiting for the refreshed preview']),
    ...(occurrence?.renderOwner === undefined ? [] : [`View: ${occurrence.renderOwner}`]),
    ...(parsed?.elementName === undefined ? [] : [`Element: ${parsed.elementName}`]),
  ]
}

function sourceLineRange(content: string, range: Readonly<{ end: number; start: number }>): string {
  if (content === '' || range.end > content.length || range.start > range.end) {
    return ''
  }
  const lineAt = (offset: number): number => content.slice(0, offset).split('\n').length
  const start = lineAt(range.start)
  const end = lineAt(Math.max(range.start, range.end - 1))
  return start === end ? `:${start}` : `:${start}–${end}`
}

export function StudioInspectorUndoAvailable(busy: boolean, canUndo: boolean): boolean {
  return !busy && canUndo
}

export function StudioInspectorDraft(drafts: string, fieldId: string): string {
  return studioInspectorDraftMap(drafts)[fieldId] ?? ''
}

export function StudioInspectorUpdateDraft(drafts: string, fieldId: string, value: string): string {
  return JSON.stringify({ ...studioInspectorDraftMap(drafts), [fieldId]: value })
}

export function studioInspectorInspection(value: string): StudioRenderInspection | undefined {
  const parsed = parseStudioJson<StudioRenderInspection>(value)
  return parsed !== undefined
      && Array.isArray(parsed.explorations)
      && Array.isArray(parsed.layoutEntries)
      && Array.isArray(parsed.styleEntries)
      && Array.isArray(parsed.styleProvenance)
      && typeof parsed.renderId === 'string'
    ? parsed
    : undefined
}

export function studioInspectorSelection(value: string): StudioInspectorSelection | undefined {
  const parsed = parseStudioJson<StudioInspectorSelection>(value)
  return parsed !== undefined
      && typeof parsed.renderId === 'string'
      && typeof parsed.identity?.path === 'string'
      && typeof parsed.identity?.sourceVersion === 'string'
      && Number.isSafeInteger(parsed.range?.start)
      && Number.isSafeInteger(parsed.range?.end)
    ? parsed
    : undefined
}

export function studioInspectorDraftMap(value: string): StudioInspectorDraftMap {
  const parsed = parseStudioJson<Record<string, unknown>>(value)
  return parsed !== undefined && Object.values(parsed).every(candidate => typeof candidate === 'string')
    ? parsed as Record<string, string>
    : {}
}
