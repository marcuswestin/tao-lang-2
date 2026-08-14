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
      if (field.kind === 'relation') {
        if (!field.relation || !definition.entities[field.relation]) {
          throw new Error(`Relationship '${entityName}.${fieldName}' has an unknown target '${field.relation ?? ''}'.`)
        }
        if (Object.prototype.hasOwnProperty.call(field, 'defaultValue') || field.defaultNow !== undefined) {
          throw new Error(`Relationship '${entityName}.${fieldName}' cannot declare a default value.`)
        }
        continue
      }
      if (field.onDelete || field.relation) {
        throw new Error(`Primitive field '${entityName}.${fieldName}' cannot declare relationship metadata.`)
      }
      const hasLiteralDefault = Object.prototype.hasOwnProperty.call(field, 'defaultValue')
      if (field.defaultNow !== undefined) {
        if (field.defaultNow !== true) {
          throw new Error(`Field '${entityName}.${fieldName}' has invalid now-default metadata.`)
        }
        if (hasLiteralDefault) {
          throw new Error(`Field '${entityName}.${fieldName}' cannot declare two defaults.`)
        }
        if (field.kind !== 'time') {
          throw new Error(`Only time field '${entityName}.${fieldName}' can default to now.`)
        }
        continue
      }
      if (!hasLiteralDefault) {
        continue
      }
      if (!valueMatchesKind(field.defaultValue, field.kind)) {
        throw new Error(`Default for '${entityName}.${fieldName}' does not match ${field.kind}.`)
      }
    }
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
