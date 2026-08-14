import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

export const dataWriteValidationMessages = {
  fieldType: (field: string, expected: string, actual: string) =>
    `Data field '${field}' expects ${expected}, got ${actual}.`,
  duplicateWriteField: (name: string) => `Data write provides field '${name}' more than once.`,
  missingCreateField: (entity: string, name: string) => `Create of '${entity}' is missing field '${name}'.`,
  unmatchedWrite: (entity: string) =>
    `Data write for '${entity}' has a value that does not match any unbound field by type.`,
  ambiguousWrite: (entity: string, fields: readonly ASTUtils.DataFieldDefinition[]) =>
    `Data write for '${entity}' has a value that matches multiple fields by type: ${
      fields.map(field => field.name).join(', ')
    }.`,
  ambiguousDataField: (entity: string, field: string) =>
    `Data write for '${entity}' has multiple values that match field '${field}' by type.`,
  duplicateFieldType: (entity: string, field: string) =>
    `Data entity '${entity}' has more than one unbound field with the same type near '${field}'.`,
  duplicateWriteType: (entity: string) =>
    `Data write for '${entity}' has more than one unlabeled value with the same exact type.`,
  unknownWriteLabel: (entity: string, name: string) =>
    `Entity '${entity}' has no field named '${name}'; labels resolve only the written owner's fields, not visible types.`,
  rowTarget: (operation: string) => `${operation} expects a row handle produced by a Tao query.`,
} as const

export const dataWriteValidationChecks = {
  [AST.CreateStatement.$type]: validateCreate,
  [AST.UpdateStatement.$type]: validateUpdate,
  [AST.DeleteStatement.$type]: (deleteStatement, ctx) => {
    validateRowTarget(deleteStatement.target, 'delete', ctx)
  },
} satisfies NodeValidationChecks

function validateCreate(create: AST.CreateStatement, ctx: ValidationContext): void {
  if (create.entity.ref) {
    validateWriteFields(create.entity.ref, create.block.fields, ctx, { requireAll: true })
  }
}

function validateUpdate(update: AST.UpdateStatement, ctx: ValidationContext): void {
  const type = validateRowTarget(update.target, 'update', ctx)
  if (type?.kind !== 'entity') {
    return
  }
  validateWriteFields(type.entity, update.block.fields, ctx, { requireAll: false })
}

function validateRowTarget(
  target: AST.Expression,
  operation: string,
  ctx: ValidationContext,
): ASTUtils.TaoType | undefined {
  const type = Type.ofExpression(target)
  if (type.kind === 'unresolved') {
    return type
  }
  if (type.kind !== 'entity') {
    ctx.error(dataWriteValidationMessages.rowTarget(operation), target)
  }
  return type
}

function validateWriteFields(
  entity: ASTUtils.DataEntityDefinition,
  fields: readonly AST.DataWriteField[],
  ctx: ValidationContext,
  { requireAll }: { requireAll: boolean },
): void {
  const result = ASTUtils.resolveDataWriteBindings(entity, fields, requireAll)
  for (const diagnostic of result.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-data-field': diagnostic => {
        ctx.error(
          dataWriteValidationMessages.missingCreateField(Type.dataEntityName(entity), diagnostic.field.name),
          fields[0]?.$container ?? entity,
        )
      },
      'unmatched-write': diagnostic => {
        ctx.error(dataWriteValidationMessages.unmatchedWrite(Type.dataEntityName(entity)), diagnostic.write)
      },
      'ambiguous-write': diagnostic => {
        ctx.error(
          dataWriteValidationMessages.ambiguousWrite(Type.dataEntityName(entity), diagnostic.fields),
          diagnostic.write,
        )
      },
      'ambiguous-data-field': diagnostic => {
        ctx.error(
          dataWriteValidationMessages.ambiguousDataField(Type.dataEntityName(entity), diagnostic.field.name),
          fields[0]?.$container ?? entity,
        )
      },
      'duplicate-field-type': diagnostic => {
        ctx.error(
          dataWriteValidationMessages.duplicateFieldType(Type.dataEntityName(entity), diagnostic.field.name),
          fields[0]?.$container ?? entity,
        )
      },
      'duplicate-write-type': diagnostic => {
        ctx.error(dataWriteValidationMessages.duplicateWriteType(Type.dataEntityName(entity)), diagnostic.write)
      },
      'unknown-named-field': diagnostic => {
        ctx.error(
          dataWriteValidationMessages.unknownWriteLabel(Type.dataEntityName(entity), diagnostic.name),
          diagnostic.write,
        )
      },
      'duplicate-named-field': diagnostic => {
        ctx.error(dataWriteValidationMessages.duplicateWriteField(diagnostic.field.name), diagnostic.write)
      },
      'named-field-type': diagnostic => {
        ctx.error(
          dataWriteValidationMessages.fieldType(
            diagnostic.field.name,
            Type.displayName(Type.dataFieldType(diagnostic.field)),
            Type.displayName(Type.ofExpression(diagnostic.write.value)),
          ),
          diagnostic.write,
        )
      },
    })
  }
}
