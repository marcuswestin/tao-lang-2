import { RuntimeAssert } from './TR-assert'
import type { TaoDataEntity, TaoDataField, TaoDataSchema, TaoQueryFilter } from './TR-data'
import { valueMatchesField } from './TR-data-definition'
import { entityHandle, metadataOf } from './TR-data-entity'
import type { StoredRow } from './TR-data-persistence'
import { matchesNarrowing } from './TR-interaction-labels'
import RuntimeSwitch from './TR-switch'
import { Clock } from './TR-units'

export type Evaluable = {
  evaluate(): { jsValue: unknown }
}

type StoredFieldValueOptions = {
  entityName: string
  fieldName: string
  field: TaoDataField
  value: unknown
  schema: TaoDataSchema
}

export function evaluatedFields(fields: Record<string, Evaluable>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, value.evaluate().jsValue]))
}

export function rowValues(
  entityName: string,
  entity: TaoDataEntity,
  values: Record<string, unknown>,
  schema: TaoDataSchema,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  assertKnownFields(entityName, entity, values)
  for (const [name, field] of Object.entries(entity.fields)) {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      result[name] = storedFieldValue({ entityName, fieldName: name, field, value: values[name], schema })
      continue
    }
    if (field.optional && !Object.prototype.hasOwnProperty.call(field, 'defaultValue')) {
      result[name] = null
      continue
    }
    RuntimeAssert.input(
      Object.prototype.hasOwnProperty.call(field, 'defaultValue') || field.defaultNow === true,
      `Create of '${entityName}' is missing required field '${name}'.`,
      { entityName, fieldName: name },
    )
    const value = field.defaultNow === true ? Clock.now() : field.defaultValue
    result[name] = storedFieldValue({ entityName, fieldName: name, field, value, schema })
  }
  return result
}

export function partialRowValues(
  entityName: string,
  entity: TaoDataEntity,
  values: Record<string, unknown>,
  schema: TaoDataSchema,
): Record<string, unknown> {
  assertKnownFields(entityName, entity, values)
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      return [
        name,
        storedFieldValue({ entityName, fieldName: name, field: entity.fields[name]!, value, schema }),
      ]
    }),
  )
}

function assertKnownFields(entityName: string, entity: TaoDataEntity, values: Record<string, unknown>): void {
  for (const name of Object.keys(values)) {
    RuntimeAssert.input(
      name !== 'Id' && entity.fields[name] !== undefined,
      `Entity '${entityName}' has no writable field '${name}'.`,
      { entityName, fieldName: name },
    )
  }
}

function storedFieldValue(
  { entityName, fieldName, field, value, schema }: StoredFieldValueOptions,
): unknown {
  if (field.optional && (value === null || value === undefined)) {
    return null
  }
  const primitive = (): unknown => {
    RuntimeAssert.input(
      valueMatchesField(value, field),
      `Field '${entityName}.${fieldName}' expects ${field.kind}, got ${valueType(value)}.`,
      { entityName, fieldName },
    )
    return value
  }
  return RuntimeSwitch(field.kind, {
    boolean: primitive,
    number: primitive,
    text: primitive,
    time: primitive,
    enum: () => {
      const selected = typeof value === 'object' && value !== null && 'caseName' in value ? value.caseName : value
      RuntimeAssert.input(
        valueMatchesField(selected, field),
        `Field '${entityName}.${fieldName}' expects a declared enum case.`,
      )
      if (typeof value === 'object' && value !== null && field.enumValues) {
        RuntimeAssert.input(
          field.enumValues()[String(selected)]?.evaluate().jsValue === value,
          `Field '${entityName}.${fieldName}' expects a case from its declared enum.`,
        )
      }
      return selected
    },
    relation: () => {
      const handle = entityHandle(value)
      RuntimeAssert.input(
        handle,
        `Relationship '${entityName}.${fieldName}' expects a live ${field.relation} entity handle.`,
        { entityName, fieldName },
      )
      return schema.relationId(handle, field.relation!, `Relationship '${entityName}.${fieldName}'`)
    },
    // References retain the target's unique value rather than a same-store row id.
    reference: () => referenceValue(entityName, fieldName, field, value),
  })
}

/**
 * referenceValue reads the target's unique field off the handle it is given. The target's own store
 * owns that value, so reading it through the handle keeps a reference honest when the two rows live
 * in different datasources and no single schema can look the other one up.
 */
function referenceValue(
  entityName: string,
  fieldName: string,
  field: TaoDataField,
  value: unknown,
): unknown {
  // A cleared reference is stored as absence, and reads back as `none`.
  if (value === null || value === undefined) {
    return null
  }
  const handle = entityHandle(value)
  RuntimeAssert.input(
    handle,
    `Reference '${entityName}.${fieldName}' expects a live ${field.relation} entity handle.`,
    { entityName, fieldName },
  )
  const metadata = metadataOf(handle)
  RuntimeAssert.input(
    metadata.entity === field.relation,
    `Reference '${entityName}.${fieldName}' expects ${field.relation}, got ${metadata.entity}.`,
    { entityName, fieldName },
  )
  // A placeholder for a row its store has not served still names that row by the value it stands for.
  const referenced = metadata.schema.referencePlaceholderValue(handle)
    ?? metadata.schema.read(handle, field.referenceField!)
  RuntimeAssert.input(
    typeof referenced === 'string' || typeof referenced === 'number',
    `Reference '${entityName}.${fieldName}' needs ${field.relation}.${field.referenceField} to have a value.`,
    { entityName, fieldName },
  )
  return referenced
}

export function queryFilterValue(
  entityName: string,
  entity: TaoDataEntity,
  filter: TaoQueryFilter,
  schema: TaoDataSchema,
): unknown {
  const field = entity.fields[filter.field]
  RuntimeAssert.input(
    field,
    `Entity '${entityName}' has no queryable field '${filter.field}'.`,
    { entityName, fieldName: filter.field },
  )
  const value = filter.value().evaluate().jsValue
  // A reference compares by the value it stores, so `where Story == Story` is an equality on the
  // target's unique field and works with the target row held in another store.
  if (field.kind === 'reference') {
    return referenceValue(entityName, filter.field, field, value)
  }
  if (field.kind !== 'relation') {
    return value
  }
  const handle = entityHandle(value)
  RuntimeAssert.input(
    handle,
    `Query filter '${entityName}.${filter.field}' expects a live ${field.relation} entity handle.`,
    { entityName, fieldName: filter.field },
  )
  return schema.relationId(
    handle,
    field.relation!,
    `Query filter '${entityName}.${filter.field}'`,
  )
}

export function matchesFilter(row: StoredRow, filter: TaoQueryFilter, expected: unknown): boolean {
  const actual = row[filter.field]
  return RuntimeSwitch(filter.operator, {
    '==': () => Object.is(actual, expected),
    '!=': () => !Object.is(actual, expected),
    '<': () => compare(actual, expected) < 0,
    '<=': () => compare(actual, expected) <= 0,
    '>': () => compare(actual, expected) > 0,
    '>=': () => compare(actual, expected) >= 0,
  })
}

/** searchFieldNames returns the entity's `(search)` field names, the multi-field corpus a query's search term matches against. */
export function searchFieldNames(entity: TaoDataEntity): string[] {
  return Object.entries(entity.fields).filter(([, field]) => field.search === true).map(([name]) => name)
}

/** querySearchTerm evaluates a query's own reactive search term, validated at compile time to be text. */
export function querySearchTerm(search: () => Evaluable): string {
  const term = search().evaluate().jsValue
  RuntimeAssert(typeof term === 'string', 'validated query search term evaluates to text', { term })
  return term
}

/**
 * matchesSearch reuses the attention matcher's locale-aware word-prefix subsequence rule for each
 * `(search)` field. One field must match the whole term; words from separate fields do not combine.
 * A blank term matches every row.
 */
export function matchesSearch(row: StoredRow, fields: readonly string[], term: string): boolean {
  if (matchesNarrowing([], term)) {
    return true
  }
  return fields.some(field => {
    const value = row[field]
    return typeof value === 'string' && matchesNarrowing([value], term)
  })
}

export function compare(left: unknown, right: unknown): number {
  if (Object.is(left, right)) {
    return 0
  }
  if (left === undefined || left === null) {
    return -1
  }
  if (right === undefined || right === null) {
    return 1
  }
  return left < right ? -1 : 1
}

function valueType(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'list' : typeof value
}
