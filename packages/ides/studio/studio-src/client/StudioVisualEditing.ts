import { Errors, Json } from '@shared/core'
import { type StudioEditorSnippet, studioPaletteComponents } from '../StudioInspector'
import type { StudioCanonicalSourceAction } from '../StudioProtocol'

export type StudioPaletteDragItem =
  | {
    component: (typeof studioPaletteComponents)[number]['component']
    kind: 'component'
    snippet: StudioEditorSnippet
  }
  | { kind: 'project-view'; snippet: StudioEditorSnippet; viewName: string }

export const studioPaletteMime = 'application/x-tao-studio-palette'

export const StudioPaletteTransfer = {
  parse(value: string): StudioPaletteDragItem | undefined {
    try {
      const parsed = JSON.parse(value) as unknown
      if (!Json.isRecord(parsed) || !isEditorSnippet(parsed['snippet'])) {
        return undefined
      }
      if (
        parsed['kind'] === 'component'
        && typeof parsed['component'] === 'string'
        && studioPaletteComponents.some(component => component.component === parsed['component'])
      ) {
        return parsed as StudioPaletteDragItem
      }
      return parsed['kind'] === 'project-view' && typeof parsed['viewName'] === 'string'
        ? parsed as StudioPaletteDragItem
        : undefined
    } catch {
      return undefined
    }
  },
  serialize(item: StudioPaletteDragItem): string {
    return JSON.stringify(item)
  },
} as const

function isEditorSnippet(value: unknown): value is StudioEditorSnippet {
  if (!Json.isRecord(value) || typeof value['text'] !== 'string') {
    return false
  }
  const text = value['text']
  return Array.isArray(value['placeholders'])
    && value['placeholders'].every(range =>
      Json.isRecord(range)
      && Number.isSafeInteger(range['start'])
      && Number.isSafeInteger(range['end'])
      && Number(range['start']) >= 0
      && Number(range['end']) >= Number(range['start'])
      && Number(range['end']) <= text.length
    )
}

export function sourceActionLabel(action: StudioCanonicalSourceAction): string {
  return action.kind.replaceAll('-', ' ')
}

export function showSourceActionError(element: HTMLElement, error: unknown): void {
  element.dataset['state'] = 'error'
  element.textContent = Errors.messageOf(error)
}
