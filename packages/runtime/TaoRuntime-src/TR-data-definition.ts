import { Switch } from '@shared/core'
import type { TaoDataField, TaoDataSchemaDefinition } from './TR-data'

export function validateDefinition(definition: TaoDataSchemaDefinition): void {
  if (!Number.isSafeInteger(definition.schemaVersion ?? 1) || (definition.schemaVersion ?? 1) < 1) {
    throw new Error(`Data schema '${definition.name}' has an invalid schema version.`)
  }
  for (const [entityName, entity] of Object.entries(definition.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (fieldName === 'Id') {
        throw new Error(`Entity '${entityName}' cannot declare reserved field 'Id'.`)
      }
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
  if (!field.relation || !definition.entities[field.relation]) {
    throw new Error(`Relationship '${fieldPath}' has an unknown target '${field.relation ?? ''}'.`)
  }
  if (Object.prototype.hasOwnProperty.call(field, 'defaultValue') || field.defaultNow !== undefined) {
    throw new Error(`Relationship '${fieldPath}' cannot declare a default value.`)
  }
}

function validatePrimitiveFieldDefinition(
  fieldPath: string,
  field: TaoDataField,
  kind: Exclude<TaoDataField['kind'], 'relation'>,
): void {
  if (field.onDelete || field.relation) {
    throw new Error(`Primitive field '${fieldPath}' cannot declare relationship metadata.`)
  }
  const hasLiteralDefault = Object.prototype.hasOwnProperty.call(field, 'defaultValue')
  if (field.defaultNow !== undefined) {
    if (field.defaultNow !== true) {
      throw new Error(`Field '${fieldPath}' has invalid now-default metadata.`)
    }
    if (hasLiteralDefault) {
      throw new Error(`Field '${fieldPath}' cannot declare two defaults.`)
    }
    if (kind !== 'time') {
      throw new Error(`Only time field '${fieldPath}' can default to now.`)
    }
    return
  }
  if (!hasLiteralDefault) {
    return
  }
  if (!valueMatchesKind(field.defaultValue, kind)) {
    throw new Error(`Default for '${fieldPath}' does not match ${kind}.`)
  }
}

export function valueMatchesKind(value: unknown, kind: Exclude<TaoDataField['kind'], 'relation'>): boolean {
  return Switch(kind, {
    boolean: () => typeof value === 'boolean',
    number: () => typeof value === 'number' && Number.isFinite(value),
    text: () => typeof value === 'string',
    time: () => typeof value === 'number' && Number.isFinite(value),
  })
}
