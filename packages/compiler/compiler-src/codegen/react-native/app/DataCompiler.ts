import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { authGrants } from '../../../auth-policy'
import { storedDataEntity, type StoredDataField } from '../../../stored-data-schema'
import { type Compiled, gen, LocalDataBindings, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import { activeDataStorePlan } from './data-store-context'
import { compileDeclarationIdentity } from './declaration-identity'

/**
 * The stdlib Local declaration's own canonical identity, restated here because the compiler emits
 * this datasource without the source ever naming it. It must stay equal to what compiling
 * `packages/apps/stdlib/@tao/data/providers/local/Local.tao` produces; `compiler.test.ts` pins that.
 */
const localDatasourceIdentity = [
  'tao.declaration',
  1,
  'tao-stdlib',
  '@tao/data',
  'providers/local/Local',
  'datasource',
  'Local',
] as const

/** DataCompiler lowers Tao schemas, reactive queries, and strict row writes to TR.Data. */
export const DataCompiler = {
  RetryStatement(statement: AST.RetryStatement): Compiled {
    return gen`TR.Data.Retry(${Compile.Expression(statement.target)})`
  },
  /**
   * DataCatalog compiles all top-level Plural / Singular declarations into provider-neutral
   * schemas, one per store. A project whose datasources declare no membership emits the single
   * `Data` catalog it always has; one that does emits a catalog per store, and `local only`
   * entities keep their own device catalog with its own connection and storage key so a synced
   * datasource never carries them.
   */
  DataCatalog(entities: readonly AST.EntityDataDeclaration[], access: readonly AST.AccessDeclaration[] = []): Compiled {
    const plan = activeDataStorePlan()
    const stores = plan?.stores ?? ASTUtils.planDataStores(entities, []).stores
    return gen`
      ${
      gen.list(
        stores.filter(store => store.kind !== 'device'),
        store => dataCatalogSchema(gen.scopeName({ name: store.binding }), store.name, store.collections, access),
        { newLines: 1 },
      )
    }
      ${
      !stores.some(store => store.kind === 'device') ? gen.noop() : gen`
        ${
        dataCatalogSchema(
          localDataCatalogScope(),
          'LocalData',
          stores.find(store => store.kind === 'device')?.collections ?? [],
          access,
        )
      }
        ${gen.scopeName({ name: LocalDataBindings.datasource })} = TR.Data.Configure(
          TR.Data.Declaration(
            'Local',
            ${gen.Name({ name: LocalDataBindings.provider })}(),
            TR.Navigation.Identity(${gen.jsLiteral([...localDatasourceIdentity])}),
          ),
          {},
        )
      `
    }
      ${
      // A project's stores resolve references among themselves and nowhere else.
      stores.length > 1
        ? gen`TR.Data.LinkStores([${
          gen.join(stores, store => gen`${gen.scopeName({ name: store.binding })}`, { separator: ', ' })
        }])`
        : gen.noop()}
    `
  },

  /** EntityDataDeclaration contributes to its file catalog and emits no standalone schema. */
  EntityDataDeclaration(): Compiled {
    return gen.noop()
  },

  EntityDataDefinition(entity: AST.EntityDataDeclaration, access: readonly AST.AccessDeclaration[] = []): Compiled {
    const order = entity.block.entries.find(AST.isDataDefaultOrder)
    const stored = storedDataEntity(entity, activeDataStorePlan())
    const fields = entity.block.entries.filter(AST.isEntityDataField)
    const policies = AST.entityCommandPoliciesOf(entity)
    const surfaced = policies.filter(policy => !policy.hide).flatMap(policy => policy.commands.map(resolveRef))
    const hidden = policies.filter(policy => policy.hide).flatMap(policy => policy.commands.map(resolveRef))
    return gen`
      [${gen.jsLiteral(entity.singularName)}]: {
        collection: ${gen.jsLiteral(stored.collection)},
        ${access.length ? gen`grants: ${gen.jsLiteral(authGrants(entity, access))},` : gen.noop()}
        ${stored.uniqueConstraints ? gen`uniqueConstraints: ${gen.jsLiteral(stored.uniqueConstraints)},` : gen.noop()}
        ${
      policies.length === 0
        ? gen.noop()
        : gen`commandPolicy: {
          surfaced: [${gen.join(surfaced, command => gen`${compileDeclarationIdentity(command)}.canonical`)}],
          hidden: [${gen.join(hidden, command => gen`${compileDeclarationIdentity(command)}.canonical`)}],
        },`
    }
        ${
      order
        ? gen`defaultOrder: { field: ${gen.jsLiteral(order.fieldName)}, direction: ${
          gen.jsLiteral(order.direction ?? 'asc')
        } },`
        : ''
    }
        fields: {
          ${
      gen.list(
        fields.filter(field => stored.fields[field.name] !== undefined),
        field => compileEntityDataField(field, stored.fields[field.name]!),
      )
    }
        },
        inverseFields: {
          ${
      gen.list(
        Object.entries(stored.inverseFields),
        ([name, inverse]) =>
          gen`[${gen.jsLiteral(name)}]: {
            relation: ${gen.jsLiteral(inverse.relation)},
            inverseField: ${gen.jsLiteral(inverse.inverseField)},
          },`,
      )
    }
        },
      },
    `
  },
  EntityQueryDeclaration(query: AST.EntityQueryDeclaration): Compiled {
    const entity = Type.queryEntity(query)
    Assert.defined(entity, 'validated current query resolves an entity')
    const clauses = query.block?.clauses ?? []
    const sourceFilter = query.source ? compileRelationSourceFilter(query.source, entity) : undefined
    return gen`
      ${gen.scopeName(query)} = TR.Data.Query(
        TR.Auth.Store(_TaoAuthScope, ${catalogScopeOf(entity)}),
        {
          entity: ${gen.jsLiteral(Type.dataEntityName(entity))},
          filters: [
            ${sourceFilter ?? ''}
            ${
      gen.list(
        clauses.filter(clause => AST.isWhereClause(clause) || AST.isBooleanWhereClause(clause)),
        clause => AST.isWhereClause(clause) ? Compile.WhereClause(clause) : Compile.BooleanWhereClause(clause),
      )
    }
          ],
          ${clauses.find(AST.isOrderClause) ? Compile.OrderClause(clauses.find(AST.isOrderClause)!) : ''}
          ${compileLimitClause(clauses.find(AST.isLimitClause))}
          ${compileSearchClause(clauses.find(AST.isSearchClause))}
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

  BooleanWhereClause(where: AST.BooleanWhereClause): Compiled {
    const field = resolveRef(where.case)
    return gen`{
      field: ${gen.jsLiteral(field.name)},
      operator: '==',
      value: () => TR.Value(${where.case.$refText === field.name ? 'true' : 'false'}),
    },`
  },

  OrderClause(order: AST.OrderClause): Compiled {
    return gen`order: {
      field: ${gen.jsLiteral(order.fieldName)},
      direction: ${gen.jsLiteral(order.direction || 'asc')},
    },`
  },

  CreateStatement(create: AST.CreateStatement): Compiled {
    const entity = resolveRef(create.entity)
    if (create.source) {
      return gen`TR.Data.CreateWith(
        TR.Auth.Store(_TaoAuthScope, ${catalogScopeOf(entity)}),
        ${gen.jsLiteral(Type.dataEntityName(entity))},
        ${Compile.Expression(create.source)},
      )`
    }
    Assert.defined(create.block, 'validated create has a write block or input source')
    const bindings = ASTUtils.resolveDataWriteBindings(entity, create.block.fields, true)
    Assert(bindings.diagnostics.length === 0, 'validated create has no field-binding diagnostics')
    return gen`TR.Data.Create(
      TR.Auth.Store(_TaoAuthScope, ${catalogScopeOf(entity)}),
      ${gen.jsLiteral(Type.dataEntityName(entity))},
      { ${gen.list(bindings.pairs, Compile.DataWriteField)} },
    )`
  },

  UpdateStatement(update: AST.UpdateStatement): Compiled {
    const targetType = Type.ofExpression(update.target)
    if (targetType.kind !== 'entity') {
      return Assert.never(targetType as never, 'validated update targets an entity row')
    }
    if (update.source) {
      return gen`TR.Data.UpdateWith(${Compile.Expression(update.target)}, ${Compile.Expression(update.source)})`
    }
    Assert.defined(update.block, 'validated update has a write block or input source')
    const bindings = ASTUtils.resolveDataWriteBindings(targetType.entity, update.block.fields, false)
    Assert(bindings.diagnostics.length === 0, 'validated update has no field-binding diagnostics')
    return gen`TR.Data.Update(
      ${Compile.Expression(update.target)},
      { ${gen.list(bindings.pairs, Compile.DataWriteField)} },
    )`
  },

  DeleteStatement(deleteStatement: AST.DeleteStatement): Compiled {
    return gen`TR.Data.Delete(${Compile.Expression(deleteStatement.target)})`
  },

  DataWriteField(pair: ASTUtils.DataWriteBindingPair): Compiled {
    const value = Compile.Expression(pair.write.value)
    return gen`[${gen.jsLiteral(pair.field.name)}]: ${pair.inverse ? gen`TR.Unary('not', ${value})` : value},`
  },
} as const

function dataCatalogSchema(
  scope: Compiled,
  name: string,
  entities: readonly AST.EntityDataDeclaration[],
  access: readonly AST.AccessDeclaration[],
): Compiled {
  return gen`
    ${scope} = TR.Data.Schema({
      name: '${name}',
      schemaVersion: 1,
      entities: {
        ${gen.list(entities, entity => DataCompiler.EntityDataDefinition(entity, access))}
      },
    })
  `
}

function dataCatalogScope(): Compiled {
  return gen.scopeName({ name: '_TaoDataCatalog' })
}

function localDataCatalogScope(): Compiled {
  return gen.scopeName({ name: LocalDataBindings.catalog })
}

/** catalogScopeOf routes one entity's reads and writes to the catalog that stores it. */
function catalogScopeOf(entity: ASTUtils.DataEntityDefinition): Compiled {
  if (Type.dataEntityIsLocalOnly(entity)) {
    return localDataCatalogScope()
  }
  const plan = activeDataStorePlan()
  const store = plan ? ASTUtils.storeOfCollection(plan, entity) : undefined
  return store ? gen.scopeName({ name: store.binding }) : dataCatalogScope()
}

function compileLimitClause(limit: AST.LimitClause | undefined): Compiled {
  return limit ? gen`limit: ${limit.count.value},` : gen.noop()
}

function compileSearchClause(search: AST.SearchClause | undefined): Compiled {
  return search ? gen`search: () => ${Compile.Expression(search.term)},` : gen.noop()
}

function compileRelationSourceFilter(
  source: AST.MemberAccessExpression,
  entity: ASTUtils.DataEntityDefinition,
): Compiled {
  const target = source.target.ref
  Assert(AST.isValueDeclaration(target), 'validated relation query source names a value declaration')
  const ownerType = Type.atMemberPath(Type.ofValueDeclaration(target), source.members.slice(0, -1))
  if (ownerType.kind !== 'entity') {
    return Assert.never(ownerType as never, 'validated relation query source has an entity owner')
  }
  const ownerEntity = ownerType.entity
  const inverseField = Type.dataFields(entity).find(field => {
    const fieldType = Type.dataFieldType(field)
    return fieldType.kind === 'entity' && fieldType.entity === ownerEntity
  })
  Assert.defined(inverseField, 'validated relation query source resolves its inverse stored field')
  const owner = source.members.length === 1
    ? Compile.ValueDeclarationReference(target)
    : gen`TR.Member(${Compile.ValueDeclarationReference(target)}, [${
      gen.join(
        source.members.slice(0, -1),
        member => gen`${gen.jsLiteral(member)}`,
      )
    }])`
  return gen`{
    field: ${gen.jsLiteral(inverseField.name)},
    operator: '==',
    value: () => ${owner},
  },`
}

/**
 * compileEntityDataField emits a field's stored shape, which `stored-data-schema` owns, with the
 * keys only the runtime reads beside it.
 */
function compileEntityDataField(field: AST.EntityDataField, stored: StoredDataField): Compiled {
  const traits = field.traits?.traits ?? []
  const defaultModifier = traits.find(trait => trait.defaultValue || trait.defaultCase)
  const type = Type.dataFieldType(field)
  const required = traits.find(AST.traitIsRequired)?.sentence
  return gen`[${gen.jsLiteral(field.name)}]: {
    ${
    gen.list(
      Object.entries(stored).filter(([, value]) => value !== undefined),
      ([key, value]) => gen`${key}: ${gen.jsLiteral(value!)},`,
    )
  }
    ${required ? gen`required: ${gen.jsLiteral(required)},` : gen.noop()}
    ${type.kind === 'enum' ? gen`enumValues: () => ${gen.scopeName(type.declaration)},` : gen.noop()}
    ${type.kind === 'primitive' && traits.some(AST.traitIsTitle) ? 'title: true,' : ''}
    ${type.kind === 'primitive' && traits.some(trait => trait.search) ? 'search: true,' : ''}
    ${
    type.kind === 'enum' || type.kind === 'primitive' ? compileEntityFieldDefault(field, defaultModifier) : gen.noop()
  }
  },`
}

function compileEntityFieldDefault(
  field: AST.EntityDataField,
  modifier: AST.Trait | undefined,
): Compiled {
  if (!modifier) {
    return field.boolean ? gen`defaultValue: false,` : gen.noop()
  }
  if (modifier.defaultCase) {
    if (Type.dataFieldType(field).kind === 'enum') {
      return gen`defaultValue: ${gen.jsLiteral(modifier.defaultCase)},`
    }
    return gen`defaultValue: ${modifier.defaultCase === field.name ? 'true' : 'false'},`
  }
  const value = modifier.defaultValue
  Assert.defined(value, 'validated field default has a value')
  return Switch.type(value, {
    NowExpression: () => gen`defaultNow: true,`,
    BooleanLiteral: value => gen`defaultValue: ${value.value},`,
    NumberLiteral: value => gen`defaultValue: ${value.value},`,
    StringLiteral: value => gen`defaultValue: ${gen.jsLiteral(value.value)},`,
  })
}
