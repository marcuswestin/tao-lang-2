import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { ValidationContext } from './validation'

/** dataValidationMessages declares structural and type diagnostics for Tao data. */
export const dataValidationMessages = {
  dataPlacement: 'Data schemas must be declared at file level.',
  duplicateCollection: (name: string) => `Data collection '${name}' is declared more than once.`,
  duplicateEntity: (name: string) => `Data entity '${name}' is declared more than once.`,
  duplicateField: (entity: string, name: string) => `Entity '${entity}' declares field '${name}' more than once.`,
  reservedField: (entity: string, name: string) =>
    `Entity '${entity}' cannot declare reserved field '${name}'; every entity receives that field automatically.`,
  unknownRelation: (entity: string, name: string) =>
    `Entity '${entity}' references unknown relationship entity '${name}'.`,
  queryPlacement: 'Queries must be declared directly inside view bodies.',
  currentQueryPlacement: 'Queries must be unconditional statements in a view body or its root render block.',
  queryAfterControl: 'Queries must be declared before the first guard, when, or loop in their block.',
  querySource: 'A query source must be a top-level plural or a plural relationship.',
  unknownCollection: (data: string, name: string) => `Data '${data}' has no collection named '${name}'.`,
  unknownEntity: (data: string, name: string) => `Data '${data}' has no entity named '${name}'.`,
  unknownField: (entity: string, name: string) => `Entity '${entity}' has no field named '${name}'.`,
  duplicateOrder: 'A query may declare only one order clause.',
  relationOrder: (name: string) => `Relationship field '${name}' cannot be used for ordering.`,
  relationComparison: (name: string, operator: string) =>
    `Relationship field '${name}' supports only == and !=, not '${operator}'.`,
  booleanComparison: (name: string, operator: string) =>
    `Boolean field '${name}' supports only == and !=, not '${operator}'.`,
  fieldType: (field: string, expected: string, actual: string) =>
    `Data field '${field}' expects ${expected}, got ${actual}.`,
  defaultType: (field: string, expected: string, actual: string) =>
    `Default for data field '${field}' expects ${expected}, got ${actual}.`,
  nowDefault: (field: string) => `Only time field '${field}' can default to now().`,
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

/** validateData validates schemas, reactive queries, and strict row writes. */
export function validateData(file: AST.TaoFile, ctx: ValidationContext): void {
  validateEntityCatalog(file, ctx)
  for (const query of AST.streamAllContents(file).filter(AST.isEntityQueryDeclaration)) {
    validateEntityQuery(query, ctx)
  }
  for (const create of AST.streamAllContents(file).filter(AST.isCreateStatement)) {
    validateCreate(create, ctx)
  }
  for (const update of AST.streamAllContents(file).filter(AST.isUpdateStatement)) {
    validateUpdate(update, ctx)
  }
  for (const deleteStatement of AST.streamAllContents(file).filter(AST.isDeleteStatement)) {
    validateRowTarget(deleteStatement.target, 'delete', ctx)
  }
}

function validateEntityCatalog(file: AST.TaoFile, ctx: ValidationContext): void {
  const entities = file.statements.filter(AST.isEntityDataDeclaration)
  reportDuplicates(entities, entity => entity.name, dataValidationMessages.duplicateCollection, ctx)
  reportDuplicates(entities, entity => entity.singularName, dataValidationMessages.duplicateEntity, ctx)
  for (const entity of entities) {
    const fields = entity.block.entries.filter(AST.isEntityDataField)
    reportDuplicates(
      fields,
      field => field.name,
      name => dataValidationMessages.duplicateField(entity.singularName, name),
      ctx,
    )
    const indexes = entity.block.entries.filter(AST.isDataIndex)
    reportDuplicates(indexes, index => index.fieldName, name => `Index '${name}' is declared more than once.`, ctx)
    const orders = entity.block.entries.filter(AST.isDataDefaultOrder)
    for (const duplicate of orders.slice(1)) {
      ctx.error(dataValidationMessages.duplicateOrder, duplicate)
    }
    for (const field of fields) {
      if (field.name === 'Id') {
        ctx.error(dataValidationMessages.reservedField(entity.singularName, field.name), field)
      }
      if (!field.primitive && !field.negativeName) {
        const direct = entities.find(candidate => candidate.singularName === field.name)
        const inverse = entities.find(candidate => candidate.name === field.name)
        if (!direct && !inverse) {
          ctx.error(dataValidationMessages.unknownRelation(entity.singularName, field.name), field)
        }
        if (inverse) {
          const inverseField = Type.dataFields(inverse).find(candidate => candidate.name === entity.singularName)
          if (!inverseField) {
            ctx.error(
              `Inverse relationship '${entity.singularName}.${field.name}' requires '${inverse.singularName}.${entity.singularName}'.`,
              field,
            )
          }
        }
      }
      validateEntityFieldDefault(field, ctx)
    }
    for (const index of indexes) {
      if (!fields.some(field => field.name === index.fieldName)) {
        ctx.error(dataValidationMessages.unknownField(entity.singularName, index.fieldName), index)
      }
    }
    for (const order of orders) {
      const field = fields.find(candidate => candidate.name === order.fieldName)
      if (!field) {
        ctx.error(dataValidationMessages.unknownField(entity.singularName, order.fieldName), order)
      } else if (Type.dataFieldType(field).kind === 'list') {
        ctx.error(dataValidationMessages.relationOrder(field.name), order)
      }
    }
  }
}

function validateEntityQuery(query: AST.EntityQueryDeclaration, ctx: ValidationContext): void {
  validateEntityQueryPlacement(query, ctx)
  const entity = Type.queryEntity(query)
  if (!entity) {
    ctx.error(dataValidationMessages.querySource, query.source ?? query)
    return
  }
  const clauses = query.block?.clauses ?? []
  const orders = clauses.filter(AST.isOrderClause)
  for (const duplicate of orders.slice(1)) {
    ctx.error(dataValidationMessages.duplicateOrder, duplicate)
  }
  const fields = Type.dataFields(entity)
  for (const clause of clauses) {
    if (AST.isBooleanWhereClause(clause)) {
      const field = clause.case.ref
      if (field && !fields.includes(field)) {
        ctx.error(dataValidationMessages.unknownField(Type.dataEntityName(entity), field.name), clause)
      }
      continue
    }
    const field = fields.find(candidate => candidate.name === clause.fieldName)
    if (!field) {
      ctx.error(dataValidationMessages.unknownField(Type.dataEntityName(entity), clause.fieldName), clause)
      continue
    }
    const fieldType = Type.dataFieldType(field)
    if (AST.isOrderClause(clause)) {
      if (fieldType.kind === 'list' || fieldType.kind === 'entity') {
        ctx.error(dataValidationMessages.relationOrder(field.name), clause)
      }
      continue
    }
    if (
      fieldType.kind === 'primitive'
      && fieldType.primitive === 'boolean'
      && clause.operator !== '=='
      && clause.operator !== '!='
    ) {
      ctx.error(dataValidationMessages.booleanComparison(field.name, clause.operator), clause)
    }
    if (fieldType.kind === 'entity' && clause.operator !== '==' && clause.operator !== '!=') {
      ctx.error(dataValidationMessages.relationComparison(field.name, clause.operator), clause)
    }
    validateFieldValue(field, clause.value, ctx)
  }
}

function validateEntityQueryPlacement(query: AST.EntityQueryDeclaration, ctx: ValidationContext): void {
  const block = query.$container
  if (!AST.isBlock(block)) {
    ctx.error(dataValidationMessages.currentQueryPlacement, query)
    return
  }
  const owner = block.$container
  const directView = AST.isVisualDeclaration(owner)
  const directRootRender = AST.isRender(owner)
    && AST.isBlock(owner.$container)
    && AST.isVisualDeclaration(owner.$container.$container)
  if (!directView && !directRootRender) {
    ctx.error(dataValidationMessages.currentQueryPlacement, query)
  }
  const queryIndex = block.statements.indexOf(query)
  const controlIndex = block.statements.findIndex(statement =>
    AST.isGuardRenderStatement(statement) || AST.isWhenRenderStatement(statement) || AST.isForStatement(statement)
  )
  if (controlIndex >= 0 && queryIndex > controlIndex) {
    ctx.error(dataValidationMessages.queryAfterControl, query)
  }
}

function validateCreate(create: AST.CreateStatement, ctx: ValidationContext): void {
  if (create.entity.ref) {
    validateWriteFields(create.entity.ref, create.block.fields, true, ctx)
  }
}

function validateEntityFieldDefault(field: AST.EntityDataField, ctx: ValidationContext): void {
  const defaults = field.modifiers.filter(modifier => modifier.defaultValue || modifier.defaultCase)
  for (const duplicate of defaults.slice(1)) {
    ctx.error(`Data field '${field.name}' declares more than one default.`, duplicate)
  }
  const modifier = defaults[0]
  if (!modifier) {
    return
  }
  if (modifier.defaultCase) {
    if (!field.negativeName || (modifier.defaultCase !== field.name && modifier.defaultCase !== field.negativeName)) {
      ctx.error(`Default case '${modifier.defaultCase}' is not a boolean case of field '${field.name}'.`, modifier)
    }
    return
  }
  const defaultValue = modifier.defaultValue
  if (!defaultValue) {
    return
  }
  if (AST.isNowExpression(defaultValue)) {
    if (field.primitive !== 'time') {
      ctx.error(dataValidationMessages.nowDefault(field.name), defaultValue)
    }
    return
  }
  const expected = Type.dataFieldType(field)
  const actual = Type.ofExpression(defaultValue)
  if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(
      dataValidationMessages.defaultType(field.name, Type.displayName(expected), Type.displayName(actual)),
      defaultValue,
    )
  }
}

function validateUpdate(update: AST.UpdateStatement, ctx: ValidationContext): void {
  const type = validateRowTarget(update.target, 'update', ctx)
  if (type?.kind !== 'entity') {
    return
  }
  validateWriteFields(type.entity, update.block.fields, false, ctx)
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
    ctx.error(dataValidationMessages.rowTarget(operation), target)
  }
  return type
}

function validateWriteFields(
  entity: ASTUtils.DataEntityDefinition,
  fields: readonly AST.DataWriteField[],
  requireAll: boolean,
  ctx: ValidationContext,
): void {
  const result = ASTUtils.resolveDataWriteBindings(entity, fields, requireAll)
  for (const diagnostic of result.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-data-field': diagnostic => {
        ctx.error(
          dataValidationMessages.missingCreateField(Type.dataEntityName(entity), diagnostic.field.name),
          fields[0]?.$container ?? entity,
        )
      },
      'unmatched-write': diagnostic => {
        ctx.error(dataValidationMessages.unmatchedWrite(Type.dataEntityName(entity)), diagnostic.write)
      },
      'ambiguous-write': diagnostic => {
        ctx.error(
          dataValidationMessages.ambiguousWrite(Type.dataEntityName(entity), diagnostic.fields),
          diagnostic.write,
        )
      },
      'ambiguous-data-field': diagnostic => {
        ctx.error(
          dataValidationMessages.ambiguousDataField(Type.dataEntityName(entity), diagnostic.field.name),
          fields[0]?.$container ?? entity,
        )
      },
      'duplicate-field-type': diagnostic => {
        ctx.error(
          dataValidationMessages.duplicateFieldType(Type.dataEntityName(entity), diagnostic.field.name),
          fields[0]?.$container ?? entity,
        )
      },
      'duplicate-write-type': diagnostic => {
        ctx.error(dataValidationMessages.duplicateWriteType(Type.dataEntityName(entity)), diagnostic.write)
      },
      'unknown-named-field': diagnostic => {
        ctx.error(
          dataValidationMessages.unknownWriteLabel(Type.dataEntityName(entity), diagnostic.name),
          diagnostic.write,
        )
      },
      'duplicate-named-field': diagnostic => {
        ctx.error(dataValidationMessages.duplicateWriteField(diagnostic.field.name), diagnostic.write)
      },
      'named-field-type': diagnostic => {
        ctx.error(
          dataValidationMessages.fieldType(
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

function validateFieldValue(field: ASTUtils.DataFieldDefinition, value: AST.Expression, ctx: ValidationContext): void {
  const expected = Type.dataFieldType(field)
  const actual = Type.ofExpression(value)
  if (expected.kind === 'unresolved' || actual.kind === 'unresolved') {
    return
  }
  if (!Type.isAssignable(actual, expected)) {
    ctx.error(dataValidationMessages.fieldType(field.name, Type.displayName(expected), Type.displayName(actual)), value)
  }
}

function reportDuplicates<Item extends AST.Node>(
  items: readonly Item[],
  nameOf: (item: Item) => string,
  message: (name: string) => string,
  ctx: ValidationContext,
): void {
  const seen = new Set<string>()
  for (const item of items) {
    const name = nameOf(item)
    if (seen.has(name)) {
      ctx.error(message(name), item)
    }
    seen.add(name)
  }
}
