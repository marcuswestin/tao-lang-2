import type { TaoDataSchemaDefinition } from './TR-data'
import type { StoredData, StoredRow } from './TR-data-persistence'

/** Mirrors trusted policy semantics for deterministic previews; remote services remain authoritative. */
export function dataAccessAllowed(
  definition: TaoDataSchemaDefinition,
  data: StoredData,
  accountId: string,
  entity: string,
  row: StoredRow,
  operation: 'read' | 'create' | 'update' | 'delete',
  fields: readonly string[] = [],
): boolean {
  const grants = definition.entities[entity]?.grants ?? []
  const matching = grants.filter(grant =>
    grant.operations.includes(operation)
    && principalAccounts(definition, data, entity, row, grant.principal).includes(accountId)
  )
  if (operation !== 'update') {
    return matching.length > 0
  }
  return matching.length > 0
    && fields.every(field => matching.some(grant => !grant.updateFields || grant.updateFields.includes(field)))
}

function principalAccounts(
  definition: TaoDataSchemaDefinition,
  data: StoredData,
  entity: string,
  row: StoredRow,
  path: readonly string[],
): string[] {
  let current: { entity: string; row: StoredRow }[] = [{ entity, row }]
  for (const name of path) {
    current = current.flatMap(value => {
      const declaration = definition.entities[value.entity]
      const inverse = declaration?.inverseFields?.[name]
      if (inverse) {
        return (data.rows[inverse.relation] ?? [])
          .filter(candidate => candidate[inverse.inverseField] === value.row.Id)
          .map(candidate => ({ entity: inverse.relation, row: candidate }))
      }
      const field = declaration?.fields[name]
      const id = value.row[name]
      if (field?.kind !== 'relation' || !field.relation || typeof id !== 'string') {
        return []
      }
      // An identity link can authorize without revealing the target's private application row.
      const target = data.rows[field.relation]?.find(candidate => candidate.Id === id) ?? { Id: id }
      return [{ entity: field.relation, row: target }]
    })
  }
  return current.map(value => value.row.Id)
}
