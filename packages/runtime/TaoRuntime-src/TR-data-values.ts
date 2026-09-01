import { RuntimeAssert } from './TR-assert'
import type { TaoDataEntity, TaoDataField, TaoDataSchema, TaoQueryFilter } from './TR-data'
import { valueMatchesKind } from './TR-data-definition'
import { entityHandle } from './TR-data-entity'
import type { StoredRow } from './TR-data-persistence'
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
  if (field.kind === 'relation') {
    const handle = entityHandle(value)
    RuntimeAssert.input(
      handle,
      `Relationship '${entityName}.${fieldName}' expects a live ${field.relation} entity handle.`,
      { entityName, fieldName },
    )
    return schema.relationId(
      handle,
      field.relation!,
      `Relationship '${entityName}.${fieldName}'`,
    )
  }
  RuntimeAssert.input(
    valueMatchesKind(value, field.kind),
    `Field '${entityName}.${fieldName}' expects ${field.kind}, got ${valueType(value)}.`,
    { entityName, fieldName },
  )
  return value
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
