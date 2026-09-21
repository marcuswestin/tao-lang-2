import type { EntityGenerationDeclaration } from '@generation'
import { Assert } from '@shared/core'
import { StudioFeedExamples } from './StudioFeedExamples'
import type { StudioFixturePlan, StudioJsonObject, StudioJsonValue } from './StudioProtocol'

declare const studioFeedItemIdBrand: unique symbol
export type StudioFeedItemId = string & { readonly [studioFeedItemIdBrand]: true }

export type StudioFeedInventoryRow = Readonly<{
  fields: StudioJsonObject
  key?: string
  name?: string
}>

export type StudioFeedInventorySource =
  | Readonly<{ kind: 'fixture'; plan: StudioFixturePlan }>
  | Readonly<{ declaration: EntityGenerationDeclaration; kind: 'generated'; seed: string }>
  | Readonly<{ entity: string; kind: 'library' | 'live'; rows: readonly StudioFeedInventoryRow[] }>

type StudioFeedInventoryItem = Readonly<{
  entity: string
  fields: StudioJsonObject
  id: StudioFeedItemId
  promotion: Readonly<{ entity: string; fields: StudioJsonObject; name: string }>
  source: Readonly<{
    kind: StudioFeedInventorySource['kind']
    row: string
    seed?: string
  }>
}>

export type StudioFeedInventoryPlan = Readonly<{
  entity: string
  items: readonly StudioFeedInventoryItem[]
}>

/** StudioFeedInventory normalizes every server-side feed source into one immutable row contract. */
export const StudioFeedInventory = {
  build(
    declaration: EntityGenerationDeclaration,
    sources: readonly StudioFeedInventorySource[],
  ): StudioFeedInventoryPlan {
    const items: StudioFeedInventoryItem[] = []
    for (const source of sources) {
      const rows = rowsForSource(declaration, source)
      for (const [index, row] of rows.entries()) {
        const fields = freezeJsonObject(validateFields(declaration, row.fields))
        const sourceRow = row.key ?? row.name ?? String(index)
        const id = opaqueId(declaration.name, source.kind, sourceRow, fields, items.map(item => item.id))
        const name = row.name ?? `${declaration.name}${titleCase(source.kind)}${index + 1}`
        items.push(Object.freeze({
          entity: declaration.name,
          fields,
          id,
          promotion: Object.freeze({ entity: declaration.name, fields, name }),
          source: Object.freeze({
            kind: source.kind,
            row: sourceRow,
            ...(source.kind === 'generated' ? { seed: source.seed } : {}),
          }),
        }))
      }
    }
    return Object.freeze({ entity: declaration.name, items: Object.freeze(items) })
  },
} as const

function rowsForSource(
  declaration: EntityGenerationDeclaration,
  source: StudioFeedInventorySource,
): readonly StudioFeedInventoryRow[] {
  if (source.kind === 'generated') {
    Assert.input(
      source.declaration.name === declaration.name,
      `Studio generated feed entity ${source.declaration.name} does not match ${declaration.name}.`,
    )
    Assert.input(
      JSON.stringify(source.declaration.fields) === JSON.stringify(declaration.fields),
      `Studio generated feed schema for ${source.declaration.name} does not match the inventory declaration.`,
    )
    return StudioFeedExamples.generate(source.declaration, source.seed).rows.map(row => ({
      fields: row.fields as StudioJsonObject,
      key: row.variant,
      name: row.name,
    }))
  }
  if (source.kind === 'fixture') {
    return source.plan.creates.flatMap(row => {
      Assert.input(
        row.entity === declaration.name,
        `Studio fixture feed entity ${row.entity} does not match ${declaration.name}.`,
      )
      return [{ fields: row.fields as StudioJsonObject, key: row.name, name: row.name }]
    })
  }
  Assert.input(
    source.entity === declaration.name,
    `Studio ${source.kind} feed entity ${source.entity} does not match ${declaration.name}.`,
  )
  return source.rows
}

function validateFields(
  declaration: EntityGenerationDeclaration,
  fields: StudioJsonObject,
): StudioJsonObject {
  const schema = new Map(declaration.fields.map(field => [field.name, field]))
  const validated: Record<string, StudioJsonValue> = {}
  for (const [name, value] of Object.entries(fields)) {
    const field = schema.get(name)
    Assert.input(field !== undefined, `Studio feed row contains unknown ${declaration.name} field ${name}.`)
    Assert.input(fieldValueMatches(field, value), `Studio feed field ${declaration.name}.${name} has the wrong type.`)
    validated[name] = value
  }
  for (const field of declaration.fields) {
    Assert.input(
      field.optional || field.defaultValue !== undefined || field.secret || field.type.kind === 'relation'
        || fields[field.name] !== undefined,
      `Studio feed row is missing required ${declaration.name}.${field.name}.`,
    )
  }
  return validated
}

function fieldValueMatches(
  field: EntityGenerationDeclaration['fields'][number],
  value: StudioJsonValue,
): boolean {
  if (field.type.kind === 'relation') {
    return typeof value === 'string'
      || isObject(value) && value['kind'] === 'fixture-reference' && typeof value['handle'] === 'string'
  }
  if (field.type.kind === 'case') {
    return typeof value === 'string' && field.type.cases.includes(value)
  }
  if (field.type.scalar === 'text') {
    return typeof value === 'string'
  }
  if (field.type.scalar === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (field.type.scalar === 'boolean') {
    return typeof value === 'boolean'
  }
  return typeof value === 'string' || isObject(value) && value['kind'] === 'now'
}

function opaqueId(
  entity: string,
  kind: StudioFeedInventorySource['kind'],
  row: string,
  fields: StudioJsonObject,
  existing: readonly StudioFeedItemId[],
): StudioFeedItemId {
  const base = `feed_${stableHash(canonicalJson([entity, kind, row, fields])).toString(36)}`
  let candidate = base
  let suffix = 2
  while (existing.includes(candidate as StudioFeedItemId)) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }
  return candidate as StudioFeedItemId
}

function canonicalJson(value: StudioJsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function stableHash(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function freezeJsonObject(value: StudioJsonObject): StudioJsonObject {
  for (const field of Object.values(value)) {
    freezeJson(field)
  }
  return Object.freeze(value)
}

function freezeJson(value: StudioJsonValue): StudioJsonValue {
  if (Array.isArray(value)) {
    value.forEach(freezeJson)
    return Object.freeze(value)
  }
  if (isObject(value)) {
    Object.values(value).forEach(freezeJson)
    return Object.freeze(value)
  }
  return value
}

function isObject(value: unknown): value is StudioJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function titleCase(value: string): string {
  return `${value[0]!.toUpperCase()}${value.slice(1)}`
}
