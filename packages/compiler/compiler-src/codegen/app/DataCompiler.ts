import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

/** DataCompiler lowers Tao schemas, reactive queries, and strict row writes to TR.Data. */
export const DataCompiler = {
  DataDeclaration(data: AST.DataDeclaration): Compiled {
    return gen`
      ${gen.scopeName(data)} = TR.Data.Schema({
        name: ${gen.jsLiteral(data.name)},
        schemaVersion: 1,
        storageKey: ${gen.jsLiteral(data.name)},
        entities: {
          ${gen.list(data.block.entities, Compile.DataEntity)}
        },
      })
    `
  },

  DataEntity(entity: AST.DataEntity): Compiled {
    return gen`
      [${gen.jsLiteral(entity.name)}]: {
        collection: ${gen.jsLiteral(entity.collectionName)},
        fields: {
          ${gen.list(entity.block.fields, Compile.DataField)}
        },
      },
    `
  },

  DataField(field: AST.DataField): Compiled {
    return field.primitive
      ? gen`[${gen.jsLiteral(field.name)}]: {
          kind: ${gen.jsLiteral(field.primitive)},
          ${field.indexed ? 'indexed: true,' : ''}
          ${field.defaultValue ? Compile.DataFieldDefault(field.defaultValue) : ''}
        },`
      : gen`[${gen.jsLiteral(field.name)}]: {
          kind: 'relation',
          relation: ${gen.jsLiteral(resolveRef(field.relation!).name)},
          ${field.onDeleteCascade ? "onDelete: 'cascade'," : ''}
        },`
  },

  /** DataFieldDefault keeps literal defaults distinct from the time-only now() sentinel. */
  DataFieldDefault(value: Exclude<AST.DataField['defaultValue'], undefined>): Compiled {
    return AST.isNowExpression(value)
      ? gen`defaultNow: true,`
      : AST.isBooleanLiteral(value)
      ? gen`defaultValue: ${value.value},`
      : AST.isNumberLiteral(value)
      ? gen`defaultValue: ${value.value},`
      : gen`defaultValue: ${gen.jsLiteral(value.value)},`
  },

  QueryDeclaration(query: AST.QueryDeclaration): Compiled {
    const data = resolveRef(query.data)
    const entity = data.block.entities.find(candidate => candidate.collectionName === query.collectionName)
    Assert.defined(entity, 'validated query collection resolves an entity', {
      collectionName: query.collectionName,
      dataName: data.name,
    })
    return gen`
      ${gen.scopeName(query)} = TR.Data.Query(
        ${gen.scopeName(data)},
        {
          entity: ${gen.jsLiteral(entity.name)},
          filters: [${gen.list(query.block?.clauses.filter(AST.isWhereClause) ?? [], Compile.WhereClause)}],
          ${
      query.block?.clauses.find(AST.isOrderClause)
        ? Compile.OrderClause(query.block.clauses.find(AST.isOrderClause)!)
        : ''
    }
        },
        TR.Value,
      )
    `
  },

  WhereClause(where: AST.WhereClause): Compiled {
    return gen`{
      field: ${gen.jsLiteral(where.fieldName)},
      operator: ${gen.jsLiteral(where.operator)},
      value: () => ${Compile.Expression(where.value)},
    },`
  },

  OrderClause(order: AST.OrderClause): Compiled {
    return gen`order: {
      field: ${gen.jsLiteral(order.fieldName)},
      direction: ${gen.jsLiteral(order.direction || 'asc')},
    },`
  },

  CreateStatement(create: AST.CreateStatement): Compiled {
    const data = resolveRef(create.data)
    return gen`TR.Data.Create(
      ${gen.scopeName(data)},
      ${gen.jsLiteral(create.entityName)},
      { ${gen.list(create.block.fields, Compile.DataWriteField)} },
    )`
  },

  UpdateStatement(update: AST.UpdateStatement): Compiled {
    return gen`TR.Data.Update(
      ${Compile.Expression(update.target)},
      { ${gen.list(update.block.fields, Compile.DataWriteField)} },
    )`
  },

  DeleteStatement(deleteStatement: AST.DeleteStatement): Compiled {
    return gen`TR.Data.Delete(${Compile.Expression(deleteStatement.target)})`
  },

  DataWriteField(field: AST.DataWriteField): Compiled {
    return gen`[${gen.jsLiteral(field.name)}]: ${Compile.Expression(field.value)},`
  },
} as const
