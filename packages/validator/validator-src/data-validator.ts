import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** dataValidationMessages declares structural and type diagnostics for Tao data. */
export const dataValidationMessages = {
  dataPlacement: 'Data schemas must be declared at file level.',
  duplicateCollection: (name: string) => `Data collection '${name}' is declared more than once.`,
  duplicateEntity: (name: string) => `Data entity '${name}' is declared more than once.`,
  duplicateField: (entity: string, name: string) => `Entity '${entity}' declares field '${name}' more than once.`,
  unknownRelation: (entity: string, name: string) =>
    `Entity '${entity}' references unknown relationship entity '${name}'.`,
  queryPlacement: 'Queries must be declared directly inside view bodies.',
  unknownCollection: (data: string, name: string) => `Data '${data}' has no collection named '${name}'.`,
  unknownEntity: (data: string, name: string) => `Data '${data}' has no entity named '${name}'.`,
  unknownField: (entity: string, name: string) => `Entity '${entity}' has no field named '${name}'.`,
  duplicateOrder: 'A query may declare only one order clause.',
  relationOrder: (name: string) => `Relationship field '${name}' cannot be used for ordering.`,
  booleanComparison: (name: string, operator: string) =>
    `Boolean field '${name}' supports only == and !=, not '${operator}'.`,
  fieldType: (field: string, expected: string, actual: string) =>
    `Data field '${field}' expects ${expected}, got ${actual}.`,
  duplicateWriteField: (name: string) => `Data write provides field '${name}' more than once.`,
  missingCreateField: (entity: string, name: string) => `Create of '${entity}' is missing field '${name}'.`,
  rowTarget: (operation: string) => `${operation} expects a row handle produced by a Tao query.`,
} as const

/** validateData validates schemas, reactive queries, and strict row writes. */
export function validateData(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const data of AST.streamAllContents(file).filter(AST.isDataDeclaration)) {
    validateSchema(data, ctx)
  }
  for (const query of AST.streamAllContents(file).filter(AST.isQueryDeclaration)) {
    validateQuery(query, ctx)
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

function validateSchema(data: AST.DataDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(data.$container)) {
    ctx.error(dataValidationMessages.dataPlacement, data)
  }
  reportDuplicates(
    data.block.entities,
    entity => entity.collectionName,
    dataValidationMessages.duplicateCollection,
    ctx,
  )
  reportDuplicates(data.block.entities, entity => entity.name, dataValidationMessages.duplicateEntity, ctx)
  const entityNames = new Set(data.block.entities.map(entity => entity.name))
  for (const entity of data.block.entities) {
    reportDuplicates(
      entity.block.fields,
      field => field.name,
      name => dataValidationMessages.duplicateField(entity.name, name),
      ctx,
    )
    for (const field of entity.block.fields) {
      if (field.relationName && !entityNames.has(field.relationName)) {
        ctx.error(dataValidationMessages.unknownRelation(entity.name, field.relationName), field)
      }
    }
  }
}

function validateQuery(query: AST.QueryDeclaration, ctx: ValidationContext): void {
  if (!isDirectViewStatement(query)) {
    ctx.error(dataValidationMessages.queryPlacement, query)
  }
  const data = query.data.ref
  if (!data) {
    return
  }
  const entity = Type.queryEntity(query)
  if (!entity) {
    ctx.error(dataValidationMessages.unknownCollection(data.name, query.collectionName), query)
    return
  }
  const clauses = query.block?.clauses ?? []
  const orders = clauses.filter(AST.isOrderClause)
  for (const duplicate of orders.slice(1)) {
    ctx.error(dataValidationMessages.duplicateOrder, duplicate)
  }
  for (const clause of clauses) {
    const field = entity.block.fields.find(candidate => candidate.name === clause.fieldName)
    if (!field) {
      ctx.error(dataValidationMessages.unknownField(entity.name, clause.fieldName), clause)
      continue
    }
    if (AST.isOrderClause(clause)) {
      if (field.relationName) {
        ctx.error(dataValidationMessages.relationOrder(field.name), clause)
      }
      continue
    }
    if (field.primitive === 'boolean' && clause.operator !== '==' && clause.operator !== '!=') {
      ctx.error(dataValidationMessages.booleanComparison(field.name, clause.operator), clause)
    }
    validateFieldValue(field, clause.value, ctx)
  }
}

function validateCreate(create: AST.CreateStatement, ctx: ValidationContext): void {
  const data = create.data.ref
  if (!data) {
    return
  }
  const entity = Type.dataEntity(data, create.entityName)
  if (!entity) {
    ctx.error(dataValidationMessages.unknownEntity(data.name, create.entityName), create)
    return
  }
  validateWriteFields(entity, create.block.fields, true, ctx)
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
  entity: AST.DataEntity,
  fields: readonly AST.DataWriteField[],
  requireAll: boolean,
  ctx: ValidationContext,
): void {
  const provided = new Set<string>()
  for (const write of fields) {
    if (provided.has(write.name)) {
      ctx.error(dataValidationMessages.duplicateWriteField(write.name), write)
    }
    provided.add(write.name)
    const field = entity.block.fields.find(candidate => candidate.name === write.name)
    if (!field) {
      ctx.error(dataValidationMessages.unknownField(entity.name, write.name), write)
      continue
    }
    validateFieldValue(field, write.value, ctx)
  }
  if (requireAll) {
    for (const field of entity.block.fields) {
      if (!provided.has(field.name)) {
        ctx.error(dataValidationMessages.missingCreateField(entity.name, field.name), fields[0]?.$container ?? entity)
      }
    }
  }
}

function validateFieldValue(field: AST.DataField, value: AST.Expression, ctx: ValidationContext): void {
  const expected = Type.dataFieldType(field)
  const actual = Type.ofExpression(value)
  if (expected.kind === 'unresolved' || actual.kind === 'unresolved') {
    return
  }
  if (!Type.isAssignable(actual, expected)) {
    ctx.error(dataValidationMessages.fieldType(field.name, Type.displayName(expected), Type.displayName(actual)), value)
  }
}

function isDirectViewStatement(query: AST.QueryDeclaration): boolean {
  const block = query.$container
  return AST.isBlock(block) && AST.isViewDeclaration(block.$container)
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
