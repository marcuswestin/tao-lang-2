import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

/** taoRowName is the generated binding a query clause reads its current row from. */
const taoRowName = '_TaoRow'

export const DataCompiler = {
  /** DataDeclaration compiles a Tao schema into a runtime data store. */
  DataDeclaration(data: AST.DataDeclaration): Compiled {
    return gen`${gen.scopeName(data)} = TR.Data.define(${JSON.stringify(dataSchema(data))})`
  },

  /** QueryDeclaration compiles a query into a reactive runtime read. */
  QueryDeclaration(query: AST.QueryDeclaration): Compiled {
    const entity = ASTUtils.queriedEntity(query)
    Assert.defined(entity, 'validated query resolves an entity', { query: query.name })
    const condition = query.condition
    const order = query.order
    const where = condition
      ? gen`, where: (${taoRowName}: TR.Row) => ${Compile.Expression(condition)}.jsValue`
      : gen``
    const orderField = order ? gen`, orderField: ${gen.jsLiteral(resolveRef(order.field).name)}` : gen``
    const orderDirection = order?.direction ? gen`, orderDirection: ${gen.jsLiteral(order.direction)}` : gen``
    return gen`${gen.scopeName(query)} = TR.Data.useQuery(${dataStoreReference(query.collection)}, { collection: ${
      gen.jsLiteral(entity.collection)
    }${where}${orderField}${orderDirection} })`
  },

  /** CreateStatement compiles entity creation into a runtime store write. */
  CreateStatement(create: AST.CreateStatement): Compiled {
    const entity = ASTUtils.mutationEntity(create)
    Assert.defined(entity, 'validated create resolves an entity', { entity: create.entity.root })
    return gen`${dataStoreReference(create.entity)}.create(${gen.jsLiteral(entity.name)}, ${
      Compile.FieldValues(create.fields)
    })`
  },

  /** UpdateStatement compiles entity updates into a runtime store write. */
  UpdateStatement(update: AST.UpdateStatement): Compiled {
    const entity = ASTUtils.mutationEntity(update)
    Assert.defined(entity, 'validated update resolves an entity', {})
    return gen`${dataStoreForEntity(entity)}.update(${gen.jsLiteral(entity.name)}, ${
      Compile.Expression(update.target)
    }.jsValue.Id, ${Compile.FieldValues(update.fields)})`
  },

  /** DeleteStatement compiles entity removal into a runtime store write. */
  DeleteStatement(deleteStatement: AST.DeleteStatement): Compiled {
    const entity = ASTUtils.mutationEntity(deleteStatement)
    Assert.defined(entity, 'validated delete resolves an entity', {})
    return gen`${dataStoreForEntity(entity)}.remove(${gen.jsLiteral(entity.name)}, ${
      Compile.Expression(deleteStatement.target)
    }.jsValue.Id)`
  },

  /** FieldValues compiles mutation field assignments into a runtime values object. */
  FieldValues(fields: readonly AST.FieldValue[]): Compiled {
    return gen`{ ${
      gen.join(fields, field => gen`${gen.jsLiteral(resolveRef(field.field).name)}: ${fieldValue(field)}`)
    } }`
  },

  /** FieldReference compiles a query or mutation field name into a read of the current row. */
  FieldReference(field: AST.FieldDeclaration): Compiled {
    return gen`TR.Member(TR.Value(${taoRowName}), ${gen.jsLiteral(field.name)})`
  },
} as const

// A reference field stores the target entity's identifier, so a whole entity value contributes its Id.
function fieldValue(field: AST.FieldValue): Compiled {
  const declaration = resolveRef(field.field)
  const compiled = Compile.Expression(field.value)
  return declaration.type
    ? gen`${compiled}.jsValue`
    : gen`TR.Member(${compiled}, "Id").jsValue`
}

function dataStoreReference(reference: AST.NamedTypeReference): Compiled {
  return gen`${gen.scopeName({ name: reference.root })}`
}

function dataStoreForEntity(entity: AST.EntityDeclaration): Compiled {
  return gen`${gen.scopeName(entity.$container)}`
}

type SchemaLiteral = Record<string, JsonValue>
type JsonValue = string | number | boolean | JsonValue[] | { [key: string]: JsonValue }

function dataSchema(data: AST.DataDeclaration): SchemaLiteral {
  return {
    name: data.name,
    entities: data.entities.map(entity => ({
      name: entity.name,
      collection: entity.collection,
      fields: entity.fields.map(fieldSchema),
    })),
  }
}

function fieldSchema(field: AST.FieldDeclaration): SchemaLiteral {
  const schema: SchemaLiteral = {
    name: field.name,
    kind: field.type ?? 'reference',
  }
  if (field.indexed) {
    schema['indexed'] = true
  }
  const defaultValue = fieldDefaultValue(field)
  if (defaultValue !== undefined) {
    schema['defaultValue'] = defaultValue
  }
  return schema
}

function fieldDefaultValue(field: AST.FieldDeclaration): JsonValue | undefined {
  const value = field.defaultValue
  if (!value) {
    return undefined
  }
  if (AST.isNowExpression(value)) {
    return 'now'
  }
  if (AST.isBooleanLiteral(value)) {
    return value.value === 'true'
  }
  return value.value
}
