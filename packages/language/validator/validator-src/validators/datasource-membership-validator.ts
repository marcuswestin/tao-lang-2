import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from '../validation'

/**
 * An app's data is the union of the stores its datasources hold, and which store holds a collection
 * is a fact about the project rather than about one app: the same query compiles once and every app
 * that runs it reads the same store. These diagnostics keep that partition well formed — one owner
 * per collection, every store bound, one datasource per store in any app, and no relation between two.
 */
export const datasourceMembershipValidationMessages = {
  overlappingMembership: (left: string, right: string, collection: string) =>
    `Datasources '${left}' and '${right}' both store '${collection}' without storing the same collections; two datasources are alternatives for one store or hold different ones, never a partial overlap.`,
  localOnlyMembership: (datasource: string, collection: string) =>
    `Datasource '${datasource}' stores '${collection}', which declares 'local only' and therefore lives in the device store.`,
  unknownMembership: (datasource: string, name: string) =>
    `Datasource '${datasource}' stores unknown data collection '${name}'.`,
  derivedMembership: (datasource: string, base: string) =>
    `Datasource '${datasource}' derives from '${base}' and stores what it stores; which collections a datasource holds is not something a derivation changes.`,
  emptyMembership: (datasource: string) =>
    `Datasource '${datasource}' declares an empty Data list; omit Data to hold the unclaimed collections, or name the collections this datasource stores.`,
  ambiguousBindingPatch: (app: string) =>
    `App ${app} patches a Datasource set without naming the datasource to patch; write the patch on one listed binding, such as \`Datasource { Personal with { ... } }\`.`,
  alternativesBound: (app: string, left: string, right: string) =>
    `App ${app} binds '${left}' and '${right}', which store the same collections; an app binds one datasource per store.`,
  unboundStore: (app: string, collections: readonly string[], datasources: readonly string[]) =>
    `App ${app} binds no datasource for the store holding ${
      collections.map(name => `'${name}'`).join(', ')
    }; bind one of ${
      datasources.map(name => `'${name}'`).join(', ')
    }. A datasource that declares no Data holds only what no other datasource in the project claims.`,
  unstoredCollection: (app: string, collection: string) =>
    `App ${app} binds no datasource that stores '${collection}'; name it in a datasource's Data, or bind a datasource that declares none to hold what the others leave.`,
  duplicateCatchAll: (app: string, left: string, right: string) =>
    `App ${app} binds '${left}' and '${right}', and neither declares Data; at most one datasource holds what the others leave.`,
  crossDatasourceRelation: (entity: string, field: string, relation: string) =>
    `Relationship '${entity}.${field}' crosses a datasource boundary; '${entity}' and '${relation}' are stored by different datasources, so write it as '(reference)'.`,
} as const

/** ProjectDataScope is one project's data: the files it reads, their catalog, and its store partition. */
export type ProjectDataScope = {
  readonly collections: readonly AST.EntityDataDeclaration[]
  readonly datasources: readonly AST.DatasourceDeclaration[]
  readonly files: readonly AST.TaoFile[]
  /** key names the scope for memoized project-wide results: the project root, or the lone file. */
  readonly key: string
  readonly plan: ASTUtils.DataStorePlan
}

/**
 * validateDatasourceMembership checks the project-wide partition and each app's binding of it. It
 * reads every declaration in the file's project — the same set the compiler partitions — because a
 * datasource, the collections it stores, and the app that binds it routinely live in three modules
 * that do not import each other. It reports only on nodes this file owns, so one mistake is reported
 * once, where it was written.
 */
export function validateDatasourceMembership(file: AST.TaoFile, ctx: ValidationContext): void {
  const scope = projectDataScope(file, ctx)
  if (scope.datasources.length === 0) {
    return
  }
  const owns = (node: AST.Node) => AST.findRoot(node) === file
  validateMembershipLists(scope.datasources.filter(owns), scope.collections, ctx)
  validateProjectPartition(scope.datasources, scope.collections, owns, ctx)
  validateCrossStoreRelations(scope, owns, ctx)
  for (const app of AST.appValueDeclarationsInFile(file)) {
    validateAppBinding(app, scope, ctx)
  }
}

/**
 * The project is the nearest ancestor directory holding a .tao/ marker. In a batch
 * validation that is the entry's whole graph; in the editor, where every document in the repository
 * is loaded, it keeps one project's datasources from partitioning another project's collections.
 */
export function projectDataScope(file: AST.TaoFile, ctx: ValidationContext): ProjectDataScope {
  const path = AST.getDocument(file).uri.path
  const root = Packages.projectRootForPath(ctx.packagesContext.index, path)
  return ctx.memo(`datasource-membership.scope.${root ?? path}`, () => {
    const files = root === undefined
      ? [file]
      : ctx.workspaceFiles.filter(candidate =>
        Packages.projectRootForPath(ctx.packagesContext.index, AST.getDocument(candidate).uri.path) === root
      )
    const collections = files.flatMap(candidate => candidate.statements.filter(AST.isEntityDataDeclaration))
    const datasources = files.flatMap(candidate => candidate.statements.filter(AST.isDatasourceDeclaration))
    return {
      collections,
      datasources,
      files,
      key: root ?? path,
      plan: ASTUtils.planDataStores(collections, datasources),
    }
  })
}

/** Each named collection must exist, must not be device-local, and a derivation may not restate them. */
function validateMembershipLists(
  datasources: readonly AST.DatasourceDeclaration[],
  collections: readonly AST.EntityDataDeclaration[],
  ctx: ValidationContext,
): void {
  for (const datasource of datasources) {
    const base = ASTUtils.derivedDatasourceBase(datasource)
    const own = ASTUtils.ownConfigurationBlock(datasource)?.entries.find(entry =>
      entry.name === ASTUtils.datasourceMembershipSlot
    )
    if (base && own) {
      ctx.error(own, datasourceMembershipValidationMessages.derivedMembership(datasource.name, base.name))
      continue
    }
    if (own?.block && own.block.entries.length === 0) {
      ctx.error(own.block, datasourceMembershipValidationMessages.emptyMembership(datasource.name))
      continue
    }
    for (const member of own?.block?.entries ?? []) {
      const name = member.reference?.$refText
      if (!name) {
        continue
      }
      const collection = collections.find(candidate => candidate.name === name)
      if (!collection) {
        ctx.error(member, datasourceMembershipValidationMessages.unknownMembership(datasource.name, name))
        continue
      }
      if (Type.dataEntityIsLocalOnly(collection)) {
        ctx.error(member, datasourceMembershipValidationMessages.localOnlyMembership(datasource.name, name))
      }
    }
  }
}

/**
 * Two datasources either store exactly the same collections — they are alternatives, which is what a
 * stub or preview is — or they store none of the same. A partial overlap would ask one collection to
 * live in two stores at once, which no query could compile against.
 */
function validateProjectPartition(
  datasources: readonly AST.DatasourceDeclaration[],
  collections: readonly AST.EntityDataDeclaration[],
  owns: (node: AST.Node) => boolean,
  ctx: ValidationContext,
): void {
  const claims = datasources.flatMap(datasource => {
    const claimed = ASTUtils.datasourceCollections(datasource, collections)
    return claimed && claimed.length > 0 ? [{ claimed, datasource }] : []
  })
  for (const [index, left] of claims.entries()) {
    for (const right of claims.slice(index + 1)) {
      const shared = left.claimed.filter(collection => right.claimed.includes(collection))
      const identical = shared.length === left.claimed.length && shared.length === right.claimed.length
      if (shared.length === 0 || identical) {
        continue
      }
      const reported = [right.datasource, left.datasource].find(owns)
      if (!reported) {
        continue
      }
      ctx.error(
        reported,
        datasourceMembershipValidationMessages.overlappingMembership(
          left.datasource.name,
          right.datasource.name,
          shared[0]!.name,
        ),
      )
    }
  }
}

/**
 * A stored `relation` resolves inside one store's rows. Its two ends may be declared in one module and
 * claimed by datasources in another, so the check runs over the project's partition and reports on
 * the relation itself; `local only` boundaries are the data validator's to report.
 */
function validateCrossStoreRelations(
  scope: ProjectDataScope,
  owns: (node: AST.Node) => boolean,
  ctx: ValidationContext,
): void {
  for (const entity of scope.collections.filter(owns)) {
    for (const field of Type.dataFields(entity)) {
      if (Type.dataFieldIsReference(field) || Type.dataFieldIsInverseRelation(field)) {
        continue
      }
      const relation = Type.dataFieldRelationEntity(field)
      if (!relation || Type.dataEntityIsLocalOnly(entity) !== Type.dataEntityIsLocalOnly(relation)) {
        continue
      }
      const owner = ASTUtils.storeOfCollection(scope.plan, entity)
      const target = ASTUtils.storeOfCollection(scope.plan, relation)
      if (owner && target && owner !== target) {
        ctx.error(
          field,
          datasourceMembershipValidationMessages.crossDatasourceRelation(
            entity.singularName,
            field.name,
            relation.singularName,
          ),
        )
      }
    }
  }
}

/**
 * An app mounts one datasource for every store its project declares, because every query over a
 * claimed collection compiles against that store whether this app meant to use it or not. What no
 * datasource claims falls to the one bound datasource that declares no membership, and an app with
 * nothing to catch it is told which collection has nowhere to live rather than failing at its first
 * query.
 */
function validateAppBinding(app: AST.AppValueDeclaration, scope: ProjectDataScope, ctx: ValidationContext): void {
  const datasourceSlot = ASTUtils.effectiveAppConfiguration(app).get('Datasource')
  if (datasourceSlot?.block) {
    for (const patch of datasourceSlot.patches) {
      ctx.error(patch, datasourceMembershipValidationMessages.ambiguousBindingPatch(app.name))
    }
  }
  const bindings = ASTUtils.appBoundDatasources(app)
  if (bindings.length === 0) {
    return
  }
  const declared = bindings.flatMap(binding => binding.declaration ? [binding.declaration] : [])
  const catchAlls = bindings.filter(binding =>
    !binding.declaration || ASTUtils.datasourceCollectionNames(binding.declaration) === undefined
  )
  for (const extra of catchAlls.slice(1)) {
    ctx.error(
      extra.node,
      datasourceMembershipValidationMessages.duplicateCatchAll(
        app.name,
        catchAlls[0]!.declaration?.name ?? 'an inline datasource',
        extra.declaration?.name ?? 'an inline datasource',
      ),
    )
  }
  for (const store of scope.plan.stores.filter(candidate => candidate.kind === 'named')) {
    const bound = declared.filter(datasource => store.datasources.includes(datasource))
    for (const extra of bound.slice(1)) {
      ctx.error(app, datasourceMembershipValidationMessages.alternativesBound(app.name, bound[0]!.name, extra.name))
    }
    if (bound.length === 0) {
      ctx.error(
        app,
        datasourceMembershipValidationMessages.unboundStore(
          app.name,
          store.collections.map(collection => collection.name),
          store.datasources.map(datasource => datasource.name),
        ),
      )
    }
  }
  if (catchAlls.length > 0) {
    return
  }
  for (const collection of scope.plan.defaultStore?.collections ?? []) {
    ctx.error(app, datasourceMembershipValidationMessages.unstoredCollection(app.name, collection.name))
  }
}
