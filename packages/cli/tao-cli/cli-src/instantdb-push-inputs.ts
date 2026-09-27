import { ASTUtils, Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import type TR from '@runtime/TR'
import { Diagnostics, Errors, FS } from '@shared'
import type { TaoDataPolicy } from 'tao-instantdb/push'

/**
 * What `tao instantdb push` reads from a Tao app before it talks to InstantDB: which InstantDB app
 * the selected app's datasource names, the compiled schema of the store that datasource fills, and
 * the compiled access policy. Everything is read statically, so a setting written as anything but a
 * literal is refused rather than guessed.
 */

/** InstantPushInputs is one app's InstantDB address, stored schema, and compiled access policy. */
export type InstantPushInputs = Readonly<{
  apiURI: string
  appId: string
  definition: TR.DataSchemaDefinition
  /** policy is the compiler's `TaoDataPolicy.json`, absent when the project declares no access rules. */
  policy: TaoDataPolicy | undefined
}>

/** instantCloudApiURI is where a datasource that names no `ApiURI` connects. */
export const instantCloudApiURI = 'https://api.instantdb.com'

const providerTypeName = 'InstantDB'
const policyFile = 'TaoDataPolicy.json'

/** readInstantPushInputs compiles one app and reads what pushing its InstantDB datasource needs. */
export async function readInstantPushInputs(appPath: string, appName: string): Promise<InstantPushInputs> {
  const workspace = await Workspace.open(FS.dirname(appPath))
  const validation = await workspace.validate(appPath)
  if (Diagnostics.hasError(validation.diagnostics)) {
    Errors.throwUserInput(
      [
        `${FS.displayPath(appPath)} has errors; fix them before pushing (\`tao check\` lists them):`,
        ...Diagnostics.errorMessages(validation.diagnostics).map(message => `- ${message}`),
      ].join('\n'),
    )
  }
  const compiled = await workspace.compile(appPath, { appName })
  const app = compiled.validation.files
    .filter(file => file.path === appPath)
    .flatMap(file => AST.appValueDeclarationsInFile(file.ast))
    .find(candidate => candidate.name === appName)
  if (app === undefined) {
    return Errors.throwUnexpected(`compiled app '${appName}' is declared in ${appPath}`)
  }
  const statements = compiled.validation.files.flatMap(file => file.ast.statements)
  const stores = ASTUtils.planDataStores(
    statements.filter(AST.isEntityDataDeclaration),
    statements.filter(AST.isDatasourceDeclaration),
  )
  const address = instantAddress(app, stores)
  const policy = compiled.files.find(file => file.relativePath === policyFile)
  return {
    ...address,
    policy: policy === undefined ? undefined : JSON.parse(policy.code) as TaoDataPolicy,
  }
}

type InstantBinding = Readonly<{
  apiURI: string
  appId: string
  store: ASTUtils.DataStore | undefined
}>

/**
 * instantAddress finds the app's InstantDB datasource. Several bindings at one address are one push
 * of every store they fill; bindings at different addresses would need one push each, which this
 * command does not do yet.
 */
function instantAddress(
  app: AST.AppValueDeclaration,
  stores: ASTUtils.DataStorePlan,
): Omit<InstantPushInputs, 'policy'> {
  const bindings = ASTUtils.appBoundDatasources(app).flatMap(binding => {
    const value = binding.value ?? binding.declaration?.value
    if (value === undefined || AST.isAppView(value)) {
      return []
    }
    const resolved = ASTUtils.resolveDatasourceValue(value, binding.patches)
    return resolved.typeNames.includes(providerTypeName) ? [instantBinding(app, binding, resolved, stores)] : []
  })
  if (bindings.length === 0) {
    Errors.throwUserInput(`App '${app.name}' binds no ${providerTypeName} datasource, so there is nothing to push.`)
  }
  const addresses = [...new Set(bindings.map(binding => `${binding.appId} at ${binding.apiURI}`))]
  if (addresses.length > 1) {
    Errors.throwUserInput(
      `App '${app.name}' binds ${providerTypeName} datasources for more than one InstantDB app (${
        addresses.join(', ')
      }); push supports one InstantDB app per Tao app.`,
    )
  }
  const collections = [...new Set(bindings.flatMap(binding => binding.store?.collections ?? []))]
  if (collections.length === 0) {
    Errors.throwUserInput(`App '${app.name}' stores no data in its ${providerTypeName} datasource.`)
  }
  const storeNames = [...new Set(bindings.flatMap(binding => binding.store === undefined ? [] : [binding.store.name]))]
  return {
    apiURI: bindings[0]!.apiURI,
    appId: bindings[0]!.appId,
    definition: storeDefinition(storeNames.join('+'), collections),
  }
}

function instantBinding(
  app: AST.AppValueDeclaration,
  binding: ASTUtils.AppDatasourceBinding,
  resolved: ASTUtils.ResolvedDatasource,
  stores: ASTUtils.DataStorePlan,
): InstantBinding {
  for (const setting of ['AppId', 'ApiURI']) {
    const written = settingEntries(binding, setting)
    if (written.some(entry => !AST.isStringLiteral(entry.value))) {
      Errors.throwUserInput(
        `App '${app.name}' sets ${providerTypeName} ${setting} to something other than a text literal; `
          + `push reads ${setting} from source, so write it as a quoted value.`,
      )
    }
  }
  const appId = resolved.configuration.get('AppId')
  if (appId === undefined || appId.trim() === '') {
    Errors.throwUserInput(`App '${app.name}' binds ${providerTypeName} without an AppId.`)
  }
  // The same store choice the compiler makes: a datasource with `Data` membership fills the store
  // it claims; one without fills the default store, which may hold nothing.
  const declaration = binding.declaration
  const claims = declaration !== undefined && ASTUtils.datasourceCollectionNames(declaration) !== undefined
  return {
    apiURI: resolved.configuration.get('ApiURI') ?? instantCloudApiURI,
    appId,
    store: claims ? ASTUtils.storeOfDatasource(stores, declaration) : stores.defaultStore,
  }
}

/**
 * settingEntries finds every place the binding's derivation writes one setting: the bound value, the
 * named declarations it derives from, and the patches laid over it where it is bound.
 */
function settingEntries(binding: ASTUtils.AppDatasourceBinding, setting: string): AST.ConfigurationEntry[] {
  const pending: AST.Node[] = [binding.node, ...binding.declaration ? [binding.declaration] : [], ...binding.patches]
  const seen = new Set<AST.Node>()
  const entries: AST.ConfigurationEntry[] = []
  while (pending.length > 0) {
    const root = pending.pop()!
    if (seen.has(root)) {
      continue
    }
    seen.add(root)
    for (const node of [root, ...AST.streamAllContents(root)]) {
      if (AST.isConfigurationEntry(node) && node.name === setting && node.value !== undefined) {
        entries.push(node)
      }
      const target =
        AST.isValueReference(node) || AST.isRefinementExpression(node) || AST.isConfigurationReference(node)
          ? node.target.ref
          : undefined
      if (target !== undefined && (AST.isDatasourceDeclaration(target) || AST.isAliasDeclaration(target))) {
        pending.push(target)
      }
    }
  }
  return entries
}

/**
 * storeDefinition lowers a store's collections to the stored-shape part of the compiled schema: the
 * fields, links, and unique constraints InstantDB stores. It restates what `DataCompiler`'s
 * `EntityDataDefinition` emits for those keys, because the compiler emits the schema only as
 * generated code; runtime-only keys (defaults, titles, command policy, grants) are left out.
 */
function storeDefinition(
  name: string,
  collections: readonly AST.EntityDataDeclaration[],
): TR.DataSchemaDefinition {
  return {
    entities: Object.fromEntries(collections.map(entity => [entity.singularName, entityDefinition(entity)])),
    name,
    schemaVersion: 1,
  }
}

type EntityDefinition = TR.DataSchemaDefinition['entities'][string]
type FieldDefinition = EntityDefinition['fields'][string]

function entityDefinition(entity: AST.EntityDataDeclaration): EntityDefinition {
  const fields = entity.block.entries.filter(AST.isEntityDataField)
  const unique = entity.block.entries.filter(AST.isDataUnique).map(entry => entry.fieldNames)
  const inverseFields: NonNullable<EntityDefinition['inverseFields']> = {}
  const stored: Record<string, FieldDefinition> = {}
  for (const field of fields) {
    if (Type.dataFieldIsInverseRelation(field)) {
      const relation = Type.dataFieldRelationEntity(field)
      const inverseField = relation === undefined
        ? undefined
        : Type.dataFields(relation).find(candidate => {
          const type = Type.dataFieldType(candidate)
          return type.kind === 'entity' && type.entity === entity
        })
      if (relation === undefined || inverseField === undefined) {
        return Errors.throwUnexpected(`validated inverse field '${entity.singularName}.${field.name}' resolves`)
      }
      inverseFields[field.name] = { inverseField: inverseField.name, relation: relation.singularName }
      continue
    }
    stored[field.name] = fieldDefinition(entity, field)
  }
  return {
    collection: entity.name,
    fields: stored,
    inverseFields,
    ...(unique.length > 0 ? { uniqueConstraints: unique } : {}),
  }
}

function fieldDefinition(owner: AST.EntityDataDeclaration, field: AST.EntityDataField): FieldDefinition {
  const traits = field.traits?.traits ?? []
  const optional = field.optional ? { optional: true } : {}
  const type = Type.dataFieldType(field)
  if (type.kind === 'enum') {
    return { kind: 'enum', ...optional }
  }
  if (type.kind === 'primitive') {
    const indexed = owner.block.entries.some(entry => AST.isDataIndex(entry) && entry.fieldName === field.name)
    return {
      kind: type.primitive as FieldDefinition['kind'],
      ...optional,
      ...(indexed ? { indexed: true } : {}),
      ...(traits.some(trait => trait.unique) ? { unique: true } : {}),
    }
  }
  const target = Type.dataFieldRelationEntity(field)
  if (target === undefined) {
    return Errors.throwUnexpected(`validated field '${owner.singularName}.${field.name}' has a stored type`)
  }
  if (Type.dataFieldIsReference(field)) {
    return { kind: 'reference', ...optional, relation: target.singularName }
  }
  return {
    kind: 'relation',
    ...optional,
    relation: target.singularName,
    ...(relationCascades(owner, target) ? { onDelete: 'cascade' as const } : {}),
  }
}

/** relationCascades mirrors the compiler: a relation cascades when its target owns the inverse. */
function relationCascades(owner: AST.EntityDataDeclaration, target: AST.EntityDataDeclaration): boolean {
  return Type.dataFields(target).some(candidate =>
    Type.dataFieldIsInverseRelation(candidate)
    && Type.dataFieldRelationEntity(candidate) === owner
    && (candidate.traits?.traits ?? []).some(trait => trait.owned)
  )
}
