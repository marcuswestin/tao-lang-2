import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
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
  DataCatalog(entities: readonly AST.EntityDataDeclaration[]): Compiled {
    const plan = activeDataStorePlan()
    const stores = plan?.stores ?? ASTUtils.planDataStores(entities, []).stores
    return gen`
      ${
      gen.list(
        stores.filter(store => store.kind !== 'device'),
        store => dataCatalogSchema(gen.scopeName({ name: store.binding }), store.name, store.collections),
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

  EntityDataDefinition(entity: AST.EntityDataDeclaration): Compiled {
    const order = entity.block.entries.find(AST.isDataDefaultOrder)
    const fields = entity.block.entries.filter(AST.isEntityDataField)
    const policies = AST.entityCommandPoliciesOf(entity)
    const surfaced = policies.filter(policy => !policy.hide).flatMap(policy => policy.commands.map(resolveRef))
    const hidden = policies.filter(policy => policy.hide).flatMap(policy => policy.commands.map(resolveRef))
    return gen`
      [${gen.jsLiteral(entity.singularName)}]: {
        collection: ${gen.jsLiteral(entity.name)},
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
          ${gen.list(fields.filter(field => !isInverseField(field)), field => compileEntityDataField(entity, field))}
        },
        inverseFields: {
          ${gen.list(fields.filter(isInverseField), field => compileInverseDataField(entity, field))}
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
        ${catalogScopeOf(entity)},
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
    const bindings = ASTUtils.resolveDataWriteBindings(entity, create.block.fields, true)
    Assert(bindings.diagnostics.length === 0, 'validated create has no field-binding diagnostics')
    return gen`TR.Data.Create(
      ${catalogScopeOf(entity)},
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
    return gen`[${gen.jsLiteral(pair.field.name)}]: ${Compile.Expression(pair.write.value)},`
  },
} as const

function dataCatalogSchema(
  scope: Compiled,
  name: string,
  entities: readonly AST.EntityDataDeclaration[],
): Compiled {
  return gen`
    ${scope} = TR.Data.Schema({
      name: '${name}',
      schemaVersion: 1,
      entities: {
        ${gen.list(entities, Compile.EntityDataDefinition)}
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

function compileRelationSourceFilter(
  source: AST.MemberAccessExpression,
  entity: ASTUtils.DataEntityDefinition,
): Compiled {
  const ownerType = Type.atMemberPath(Type.ofValueDeclaration(source.target.ref), source.members.slice(0, -1))
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
    ? Compile.ValueDeclarationReference(resolveRef(source.target))
    : gen`TR.Member(${Compile.ValueDeclarationReference(resolveRef(source.target))}, [${
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

function compileEntityDataField(
  owner: AST.EntityDataDeclaration,
  field: AST.EntityDataField,
): Compiled {
  const traits = field.traits?.traits ?? []
  const indexed = owner.block.entries.some(entry => AST.isDataIndex(entry) && entry.fieldName === field.name)
  const defaultModifier = traits.find(trait => trait.defaultValue || trait.defaultCase)
  if (field.primitive || field.boolean) {
    const kind = field.boolean ? 'boolean' : field.primitive!
    return gen`[${gen.jsLiteral(field.name)}]: {
      kind: ${gen.jsLiteral(kind)},
      ${indexed ? 'indexed: true,' : ''}
      ${traits.some(trait => trait.unique) ? 'unique: true,' : ''}
      ${traits.some(AST.traitIsTitle) ? 'title: true,' : ''}
      ${compileEntityFieldDefault(field, defaultModifier)}
    },`
  }
  const direct = Type.dataFieldRelationEntity(field)
  if (direct && Type.dataFieldIsReference(field)) {
    // A reference is stored as the target's unique value, so it survives the target living in
    // another store; the runtime resolves it to a handle in whichever store holds that entity.
    const unique = Type.dataFields(direct).find(candidate =>
      (candidate.traits?.traits ?? []).some(trait => trait.unique)
    )
    Assert.defined(unique, 'validated reference target declares a unique field')
    const plan = activeDataStorePlan()
    const store = plan ? ASTUtils.storeOfCollection(plan, direct) : undefined
    return gen`[${gen.jsLiteral(field.name)}]: {
      kind: 'reference',
      relation: ${gen.jsLiteral(direct.singularName)},
      referenceField: ${gen.jsLiteral(unique.name)},
      ${store ? gen`store: ${gen.jsLiteral(store.name)},` : ''}
    },`
  }
  if (direct && !Type.dataFieldIsInverseRelation(field)) {
    return gen`[${gen.jsLiteral(field.name)}]: {
      kind: 'relation',
      relation: ${gen.jsLiteral(direct.singularName)},
      ${storedRelationCascades(owner, direct) ? "onDelete: 'cascade'," : ''}
    },`
  }
  return Assert.never(field as never, 'inverse fields compile through inverseFields')
}

function compileInverseDataField(owner: AST.EntityDataDeclaration, field: AST.EntityDataField): Compiled {
  const inverse = Type.dataFieldRelationEntity(field)
  Assert.defined(inverse, 'validated inferred inverse relation resolves its entity')
  const inverseField = inverse.block.entries
    .filter(AST.isEntityDataField)
    .find(candidate => {
      const candidateType = Type.dataFieldType(candidate)
      return candidateType.kind === 'entity' && candidateType.entity === owner
    })
  Assert.defined(inverseField, 'validated inverse relation resolves its stored field')
  return gen`[${gen.jsLiteral(field.name)}]: {
    relation: ${gen.jsLiteral(inverse.singularName)},
    inverseField: ${gen.jsLiteral(inverseField.name)},
  },`
}

function isInverseField(field: AST.EntityDataField): boolean {
  return Type.dataFieldIsInverseRelation(field)
}

function storedRelationCascades(
  owner: AST.EntityDataDeclaration,
  target: AST.EntityDataDeclaration,
): boolean {
  return Type.dataFields(target).some(candidate => {
    if (!Type.dataFieldIsInverseRelation(candidate)) {
      return false
    }
    const related = Type.dataFieldRelationEntity(candidate)
    return related === owner && (candidate.traits?.traits ?? []).some(trait => trait.owned)
  })
}

function compileEntityFieldDefault(
  field: AST.EntityDataField,
  modifier: AST.Trait | undefined,
): Compiled {
  if (!modifier) {
    return field.boolean ? gen`defaultValue: false,` : gen.noop()
  }
  if (modifier.defaultCase) {
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
