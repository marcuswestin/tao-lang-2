import { Type } from '@ast-utils'
import { AST } from '@parser'

/** This is deployment metadata. A server loads it at startup, never from an authenticated request. */
export function authPolicy(entities: readonly AST.EntityDataDeclaration[], access: readonly AST.AccessDeclaration[]) {
  return {
    accountEntity: 'Account',
    entities: Object.fromEntries(entities.map(entity => {
      const fields = Type.dataFields(entity)
      const relations = fields.flatMap(field => {
        const target = Type.dataFieldRelationEntity(field)
        if (!target) {
          return []
        }
        const inverse = Type.dataFieldIsInverseRelation(field)
        const inverseField = inverse
          ? Type.dataFields(target).find(candidate =>
            Type.dataFieldRelationEntity(candidate) === entity && !Type.dataFieldIsInverseRelation(candidate)
          )
          : undefined
        return [[field.name, {
          entity: target.singularName,
          ...(inverseField ? { inverse: inverseField.name, many: true } : {}),
        }]]
      })
      return [entity.singularName, {
        fields: fields.filter(field => !Type.dataFieldIsInverseRelation(field)).map(field => field.name),
        fieldTypes: Object.fromEntries(fields.flatMap(field => {
          const type = Type.dataFieldType(field)
          return type.kind === 'primitive' ? [[field.name, type.primitive]] : []
        })),
        enumCases: Object.fromEntries(fields.flatMap(field => {
          const type = Type.dataFieldType(field)
          return type.kind === 'enum'
            ? [[field.name, AST.caseSetCasesOf(type.declaration).map(AST.caseSetCaseName)]]
            : []
        })),
        grants: authGrants(entity, access),
        relations: Object.fromEntries(relations),
        unique: [
          ...fields.filter(field => field.traits?.traits.some(trait => trait.unique)).map(field => [field.name]),
          ...entity.block.entries.filter(AST.isDataUnique).map(entry => entry.fieldNames),
        ],
      }]
    })),
  }
}

/** One grant per operation preserves field-scoped updates alongside unrestricted read/create. */
export function authGrants(entity: AST.EntityDataDeclaration, access: readonly AST.AccessDeclaration[]) {
  return access.filter(declaration => declaration.entity.ref === entity).flatMap(declaration =>
    declaration.rules.flatMap(rule =>
      rule.grants.map(grant => ({
        operations: [grant.operation],
        principal: rule.actorPath[0] === entity.singularName ? rule.actorPath.slice(1) : rule.actorPath,
        ...(grant.operation === 'update' ? { updateFields: grant.fields } : {}),
      }))
    )
  )
}
