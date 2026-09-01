import { RuntimeAssert } from './TR-assert'
import type { TaoDataField, TaoDataSchemaDefinition } from './TR-data'
import RuntimeSwitch from './TR-switch'

export function validateDefinition(definition: TaoDataSchemaDefinition): void {
  RuntimeAssert.input(
    Number.isSafeInteger(definition.schemaVersion ?? 1) && (definition.schemaVersion ?? 1) >= 1,
    `Data schema '${definition.name}' has an invalid schema version.`,
    { schema: definition.name },
  )
  for (const [entityName, entity] of Object.entries(definition.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      RuntimeAssert.input(fieldName !== 'Id', `Entity '${entityName}' cannot declare reserved field 'Id'.`, {
        entityName,
      })
      const fieldPath = `${entityName}.${fieldName}`
      if (field.kind === 'relation') {
        validateRelationshipFieldDefinition(definition, fieldPath, field)
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

function validatePrimitiveFieldDefinition(
  fieldPath: string,
  field: TaoDataField,
  kind: Exclude<TaoDataField['kind'], 'relation'>,
): void {
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
    valueMatchesKind(field.defaultValue, kind),
    `Default for '${fieldPath}' does not match ${kind}.`,
    { fieldPath },
  )
}

export function valueMatchesKind(value: unknown, kind: Exclude<TaoDataField['kind'], 'relation'>): boolean {
  return RuntimeSwitch(kind, {
    boolean: () => typeof value === 'boolean',
    number: () => typeof value === 'number' && Number.isFinite(value),
    text: () => typeof value === 'string',
    time: () => typeof value === 'number' && Number.isFinite(value),
  })
}
