import { Json } from '@shared/core'
import type { StudioFeedBrowserInventory } from '../StudioFeedBrowser'
import type { StudioFeedState } from '../StudioFeedProtocol'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import type { StudioSketchCatalogSnapshot } from '../StudioSketchCatalog'

export type StudioFeedSample = Readonly<{ text: string; imageUrl?: string; label: string }>
export type StudioFeedExampleValues = Readonly<Record<string, Readonly<Record<string, StudioFeedSample>>>>

type Row = Readonly<{ label: string; fields: Readonly<Record<string, unknown>> }>

/** Sample values are render-only: catalog bindings keep parameter/path identities, never example text. */
export const StudioFeedSamples = {
  project(
    catalog: StudioSketchCatalogSnapshot,
    inventory: StudioFeedBrowserInventory,
    selection: Pick<StudioFeedState, 'rowId' | 'sketchId'>,
    manifest?: StudioPreviewManifestV2,
    focusedScenarioId?: string,
  ): StudioFeedExampleValues {
    const examples: Record<string, Record<string, StudioFeedSample>> = {}
    const inventoryRows = inventory.entities.flatMap(entity => entity.sources.flatMap(source => source.rows))
    const selectedRow = inventoryRows.find(row => row.id === selection.rowId)
    const selectedEntity = inventory.entities.find(entity =>
      entity.sources.some(source => source.rows.some(row => row.id === selection.rowId))
    )
    for (const sketch of catalog.sketches) {
      const subject = manifest?.subjects.find(item => item.kind === 'view' && item.viewName === sketch.view)
      const scenarios = manifest?.scenarios.filter(item => item.subjectId === subject?.subjectId) ?? []
      const scenario = scenarios.find(item => item.scenarioId === focusedScenarioId) ?? scenarios[0]
      const fixture = manifest?.fixtures.find(item => item.fixtureId === scenario?.fixtureId)
      const creates = fixture?.plan['creates']
      const fixtureRows: Row[] = Array.isArray(creates)
        ? creates.flatMap(create =>
          Json.isRecord(create) && typeof create['name'] === 'string' && Json.isRecord(create['fields'])
            ? [{ label: create['name'], fields: create['fields'] }]
            : []
        )
        : []
      const values: Record<string, StudioFeedSample> = {}
      for (const rect of sketch.rects) {
        const binding = rect.fieldBinding
        if (binding === undefined) {
          continue
        }
        const transient = selectedRow !== undefined && selection.sketchId === sketch.id
          && selectedEntity?.name === binding.parameter
        const rows: readonly Row[] = transient
          ? inventoryRows.filter(row => row.source.fixtureId === selectedRow.source.fixtureId)
          : fixtureRows
        const argument = scenario?.args[binding.parameter]
        const root = transient ? selectedRow.fields : resolveReference(argument, rows)
        const value = fieldValue(root, binding.path.split('.'), rows)
        if (value === undefined || value === null || typeof value === 'object') {
          continue
        }
        const text = String(value)
        const labelValue = binding.presentation.label === undefined
          ? undefined
          : fieldValue(root, binding.presentation.label.path.split('.'), rows)
        const label = labelValue === undefined
          ? binding.path
          : `${binding.presentation.label?.prefix ?? ''}${String(labelValue)}${
            binding.presentation.label?.suffix ?? ''
          }`
        const imageUrl = binding.presentation.kind === 'image' ? safeImageUrl(text) : undefined
        values[rect.id] = { text, label, ...(imageUrl === undefined ? {} : { imageUrl }) }
      }
      examples[sketch.id] = values
    }
    return examples
  },
  fieldValue,
} as const

function resolveReference(value: unknown, rows: readonly Row[]): unknown {
  if (!Json.isRecord(value) || value['kind'] !== 'fixture-reference' || typeof value['handle'] !== 'string') {
    return value
  }
  const matching = rows.filter(row => row.label === value['handle'])
  return matching.length === 1 ? matching[0]?.fields : undefined
}

function fieldValue(root: unknown, path: readonly string[], rows: readonly Row[]): unknown {
  let value = resolveReference(root, rows)
  for (const part of path) {
    if (!Json.isRecord(value) || !Object.hasOwn(value, part)) {
      return undefined
    }
    value = resolveReference(value[part], rows)
  }
  return value
}

function safeImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === ''
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
