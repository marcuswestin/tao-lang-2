import { Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** accessValidationMessages describes policy mistakes before backend compilation. */
export const accessValidationMessages = {
  placement: 'Access rules must be declared at file level.',
  actor: (path: string) =>
    `Access actor '${path}' must reach an Account or a collection of Accounts from the protected row.`,
  unknownField: (entity: string, field: string) => `Access rule for '${entity}' names unknown field '${field}'.`,
  fieldsOperation: 'Only update grants may name fields.',
  updateFields: 'An update grant must name the fields it permits changing.',
  inverseField: (field: string) =>
    `Update grant cannot name inverse collection '${field}'; grant its stored relationship instead.`,
  duplicateField: (field: string) => `Update grant repeats field '${field}'.`,
} as const

export const accessValidationChecks = {
  [AST.AccessDeclaration.$type]: validateAccess,
} satisfies NodeValidationChecks

function validateAccess(declaration: AST.AccessDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(declaration.$container)) {
    ctx.error(declaration, accessValidationMessages.placement)
  }
  const entity = declaration.entity.ref
  if (!entity) {
    return
  }
  for (const rule of declaration.rules) {
    let reached: AST.EntityDataDeclaration | undefined = entity
    const path = rule.actorPath[0] === entity.singularName ? rule.actorPath.slice(1) : rule.actorPath
    for (const name of path) {
      const field: AST.EntityDataField | undefined = reached
        && Type.dataFields(reached).find(field => field.name === name)
      reached = field && Type.dataFieldRelationEntity(field)
    }
    if (reached?.singularName !== 'Account') {
      ctx.error(rule, accessValidationMessages.actor(rule.actorPath.join('.')))
    }
    for (const grant of rule.grants) {
      if (grant.operation !== 'update' && grant.fields.length > 0) {
        ctx.error(grant, accessValidationMessages.fieldsOperation)
      }
      if (grant.operation === 'update' && grant.fields.length === 0) {
        ctx.error(grant, accessValidationMessages.updateFields)
      }
      const seen = new Set<string>()
      for (const name of grant.fields) {
        const field = Type.dataFields(entity).find(field => field.name === name)
        if (!field) {
          ctx.error(grant, accessValidationMessages.unknownField(entity.singularName, name))
        } else if (Type.dataFieldIsInverseRelation(field)) {
          ctx.error(grant, accessValidationMessages.inverseField(name))
        }
        if (seen.has(name)) {
          ctx.error(grant, accessValidationMessages.duplicateField(name))
        }
        seen.add(name)
      }
    }
  }
}
