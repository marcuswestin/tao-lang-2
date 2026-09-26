import { RuntimeAssert } from './TR-assert'
import type { TaoDataEntity, TaoDataField, TaoDataSchemaDefinition } from './TR-data'
import RuntimeSwitch from './TR-switch'

export function validateDefinition(definition: TaoDataSchemaDefinition): void {
  RuntimeAssert.input(
    Number.isSafeInteger(definition.schemaVersion ?? 1) && (definition.schemaVersion ?? 1) >= 1,
    `Data schema '${definition.name}' has an invalid schema version.`,
    { schema: definition.name },
  )
  for (const [entityName, entity] of Object.entries(definition.entities)) {
    for (const fields of entity.uniqueConstraints ?? []) {
      RuntimeAssert.input(
        fields.length > 0 && new Set(fields).size === fields.length
          && fields.every(name => entity.fields[name] !== undefined),
        `Unique constraint on '${entityName}' must name distinct declared fields.`,
      )
    }
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      RuntimeAssert.input(fieldName !== 'Id', `Entity '${entityName}' cannot declare reserved field 'Id'.`, {
        entityName,
      })
      const fieldPath = `${entityName}.${fieldName}`
      if (field.kind === 'relation') {
        validateRelationshipFieldDefinition(definition, fieldPath, field)
        continue
      }
      if (field.kind === 'reference') {
        validateReferenceFieldDefinition(fieldPath, field)
        continue
      }
      validatePrimitiveFieldDefinition(fieldPath, field, field.kind)
    }
  }
}

function validateRelationshipFieldDefinition(
  definition: TaoDataSchemaDefinition,
  fieldPath: string,
  field: TaoDataField,
): void {
  RuntimeAssert.input(
    field.relation && definition.entities[field.relation],
    `Relationship '${fieldPath}' has an unknown target '${field.relation ?? ''}'.`,
    { fieldPath },
  )
  RuntimeAssert.input(
    !Object.prototype.hasOwnProperty.call(field, 'defaultValue') && field.defaultNow === undefined,
    `Relationship '${fieldPath}' cannot declare a default value.`,
    { fieldPath },
  )
}

/**
 * A reference names its target by name rather than by this schema's rows, because the target may
 * live in another store entirely. It therefore needs the target entity and the unique field it is
 * stored as, and it owns nothing: a delete on one side of a store boundary cannot reach the other.
 */
function validateReferenceFieldDefinition(fieldPath: string, field: TaoDataField): void {
  RuntimeAssert.input(field.relation, `Reference '${fieldPath}' has no target entity.`, { fieldPath })
  RuntimeAssert.input(
    field.referenceField,
    `Reference '${fieldPath}' has no target unique field.`,
    { fieldPath },
  )
  RuntimeAssert.input(
    !field.onDelete,
    `Reference '${fieldPath}' cannot cascade a delete across a datasource boundary.`,
    { fieldPath },
  )
  RuntimeAssert.input(
    !Object.prototype.hasOwnProperty.call(field, 'defaultValue') && field.defaultNow === undefined,
    `Reference '${fieldPath}' cannot declare a default value.`,
    { fieldPath },
  )
}

function validatePrimitiveFieldDefinition(
  fieldPath: string,
  field: TaoDataField,
  kind: Exclude<TaoDataField['kind'], 'reference' | 'relation'>,
): void {
  if (kind === 'enum') {
    RuntimeAssert.input(
      !!field.cases?.length && new Set(field.cases).size === field.cases.length,
      `Enum field '${fieldPath}' must declare distinct cases.`,
    )
  }
  RuntimeAssert.input(
    !field.onDelete && !field.relation,
    `Primitive field '${fieldPath}' cannot declare relationship metadata.`,
    { fieldPath },
  )
  const hasLiteralDefault = Object.prototype.hasOwnProperty.call(field, 'defaultValue')
  if (field.defaultNow !== undefined) {
    RuntimeAssert.input(field.defaultNow === true, `Field '${fieldPath}' has invalid now-default metadata.`, {
      fieldPath,
    })
    RuntimeAssert.input(!hasLiteralDefault, `Field '${fieldPath}' cannot declare two defaults.`, { fieldPath })
    RuntimeAssert.input(kind === 'time', `Only time field '${fieldPath}' can default to now.`, { fieldPath })
    return
  }
  if (!hasLiteralDefault) {
    return
  }
  RuntimeAssert.input(
    valueMatchesField(field.defaultValue, field),
    `Default for '${fieldPath}' does not match ${kind}.`,
    { fieldPath },
  )
}

function valueMatchesKind(
  value: unknown,
  kind: Exclude<TaoDataField['kind'], 'reference' | 'relation'>,
): boolean {
  return RuntimeSwitch(kind, {
    boolean: () => typeof value === 'boolean',
    number: () => typeof value === 'number' && Number.isFinite(value),
    text: () => typeof value === 'string',
    enum: () => typeof value === 'string',
    time: () => typeof value === 'number' && Number.isFinite(value),
  })
}

export function valueMatchesField(value: unknown, field: TaoDataField): boolean {
  if (value === null || value === undefined) {
    return field.optional === true
  }
  return field.kind === 'enum'
    ? typeof value === 'string' && field.cases?.includes(value) === true
    : field.kind === 'relation' || field.kind === 'reference'
    ? typeof value === 'string' || (field.kind === 'reference' && typeof value === 'number')
    : valueMatchesKind(value, field.kind)
}

/** Uniqueness compares typed tuples; any absent component makes that row distinct. */
export function validateUniqueRows(
  entityName: string,
  entity: TaoDataEntity,
  rows: readonly Readonly<Record<string, unknown>>[],
): void {
  const constraints = [
    ...Object.entries(entity.fields).filter(([, field]) => field.unique).map(([name]) => [name]),
    ...(entity.uniqueConstraints ?? []),
  ]
  for (const fields of constraints) {
    const keys = new Set<string>()
    for (const row of rows) {
      const tuple = fields.map(field => row[field])
      if (tuple.some(value => value === null || value === undefined)) {
        continue
      }
      const key = JSON.stringify(tuple)
      RuntimeAssert.input(!keys.has(key), `Unique constraint '${entityName}.${fields.join(' + ')}' is already used.`)
      keys.add(key)
    }
  }
}
