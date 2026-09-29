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
  updateInput: (entity: string) => `Update of '${entity}' expects an input item copied from that entity.`,
  updateInputField: (entity: string, field: string) => `Update of '${entity}' cannot write projected field '${field}'.`,
  createInput: (entity: string) => `Create of '${entity}' expects an input item projected from that entity.`,
  createInputField: (entity: string, field: string) => `Create of '${entity}' cannot write projected field '${field}'.`,
  createInputMissing: (entity: string, field: string) =>
    `Create of '${entity}' needs field '${field}', which its input item does not project.`,
  toggleTarget: () => '`toggle` expects a writable boolean state or a row field.',
  toggleField: (entity: string) => `Toggle of '${entity}' expects one stored yes/no field.`,
  toggleOptional: (entity: string, field: string) =>
    `Toggle of '${entity}.${field}' requires a nonoptional yes/no field.`,
} as const

export const dataWriteValidationChecks = {
  [AST.CreateStatement.$type]: validateCreate,
  [AST.UpdateStatement.$type]: validateUpdate,
  [AST.ToggleStatement.$type]: validateToggle,
  [AST.DeleteStatement.$type]: (deleteStatement, ctx) => {
    validateRowTarget(deleteStatement.target, 'delete', ctx)
  },
  [AST.RetryStatement.$type]: (retryStatement, ctx) => {
    validateRowTarget(retryStatement.target, 'retry', ctx)
  },
} satisfies NodeValidationChecks

function validateToggle(toggle: AST.ToggleStatement, ctx: ValidationContext): void {
  const target = toggle.target.ref
  if (!target) {
    return
  }
  const type = Type.ofValueDeclaration(target)
  if (AST.isStateDeclaration(target) && type.kind !== 'entity') {
    return
  }
  if (AST.isParameterDeclaration(target) && type.kind !== 'entity') {
    return
  }
  if (type.kind === 'unresolved') {
    return
  }
  if (type.kind !== 'entity') {
    ctx.error(toggle, dataWriteValidationMessages.toggleTarget())
    return
  }
  const field = toggle.members.length === 1
    ? Type.dataFields(type.entity).find(candidate => candidate.name === toggle.members[0])
    : undefined
  const entityName = Type.dataEntityName(type.entity)
  if (!field || !field.boolean) {
    ctx.error(toggle, dataWriteValidationMessages.toggleField(entityName))
  } else if (field.optional) {
    ctx.error(toggle, dataWriteValidationMessages.toggleOptional(entityName, field.name))
  }
}

function validateCreate(create: AST.CreateStatement, ctx: ValidationContext): void {
  const entity = create.entity.ref
  if (!entity) {
    return
  }
  if (create.block) {
    validateWriteFields(entity, create.block.fields, ctx, { requireAll: true })
    return
  }
  if (create.source) {
    validateCreateInput(entity, create.source, ctx)
  }
}

/**
 * `create Entity with Input` writes the input's projected fields, so the projection must be of that
 * entity, carry no to-many relation, and cover every field a `create { }` would have to supply.
 */
function validateCreateInput(
  entity: ASTUtils.DataEntityDefinition,
  input: AST.Expression,
  ctx: ValidationContext,
): void {
  const source = Type.ofExpression(input)
  if (source.kind === 'unresolved') {
    return
  }
  const name = Type.dataEntityName(entity)
  if (Type.projectedEntityOf(source) !== entity) {
    ctx.error(input, dataWriteValidationMessages.createInput(name))
    return
  }
  const projected = new Set(source.kind === 'item' ? source.item?.dataFields ?? [] : [])
  for (const field of projected) {
    if (Type.dataFieldType(field).kind === 'list') {
      ctx.error(input, dataWriteValidationMessages.createInputField(name, field.name))
    }
  }
  for (const field of Type.dataFields(entity).filter(ASTUtils.createRequiresField)) {
    if (!projected.has(field)) {
      ctx.error(input, dataWriteValidationMessages.createInputMissing(name, field.name))
    }
  }
}

function validateUpdate(update: AST.UpdateStatement, ctx: ValidationContext): void {
  const type = validateRowTarget(update.target, 'update', ctx)
  if (type?.kind !== 'entity') {
    return
  }
  if (update.block) {
    validateWriteFields(type.entity, update.block.fields, ctx, { requireAll: false })
    return
  }
  if (!update.source) {
    return
  }
  const source = Type.ofExpression(update.source)
  if (Type.projectedEntityOf(source) !== type.entity) {
    ctx.error(update.source, dataWriteValidationMessages.updateInput(Type.dataEntityName(type.entity)))
    return
  }
  const fields = source.kind === 'item' ? source.item?.dataFields ?? [] : []
  for (const field of fields) {
    if (Type.dataFieldType(field).kind === 'list') {
      ctx.error(
        update.source,
        dataWriteValidationMessages.updateInputField(Type.dataEntityName(type.entity), field.name),
      )
    }
  }
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
    ctx.error(target, dataWriteValidationMessages.rowTarget(operation))
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
          fields[0]?.$container ?? entity,
          dataWriteValidationMessages.missingCreateField(Type.dataEntityName(entity), diagnostic.field.name),
        )
      },
      'unmatched-write': diagnostic => {
        ctx.error(diagnostic.write, dataWriteValidationMessages.unmatchedWrite(Type.dataEntityName(entity)))
      },
      'ambiguous-write': diagnostic => {
        ctx.error(
          diagnostic.write,
          dataWriteValidationMessages.ambiguousWrite(Type.dataEntityName(entity), diagnostic.fields),
        )
      },
      'ambiguous-data-field': diagnostic => {
        ctx.error(
          fields[0]?.$container ?? entity,
          dataWriteValidationMessages.ambiguousDataField(Type.dataEntityName(entity), diagnostic.field.name),
        )
      },
      'duplicate-field-type': diagnostic => {
        ctx.error(
          fields[0]?.$container ?? entity,
          dataWriteValidationMessages.duplicateFieldType(Type.dataEntityName(entity), diagnostic.field.name),
        )
      },
      'duplicate-write-type': diagnostic => {
        ctx.error(diagnostic.write, dataWriteValidationMessages.duplicateWriteType(Type.dataEntityName(entity)))
      },
      'unknown-named-field': diagnostic => {
        ctx.error(
          diagnostic.write,
          dataWriteValidationMessages.unknownWriteLabel(Type.dataEntityName(entity), diagnostic.name),
        )
      },
      'duplicate-named-field': diagnostic => {
        ctx.error(diagnostic.write, dataWriteValidationMessages.duplicateWriteField(diagnostic.field.name))
      },
      'named-field-type': diagnostic => {
        ctx.error(
          diagnostic.write,
          dataWriteValidationMessages.fieldType(
            diagnostic.field.name,
            Type.displayName(Type.dataFieldType(diagnostic.field)),
            Type.displayName(Type.ofExpression(diagnostic.write.value)),
          ),
        )
      },
    })
  }
}
