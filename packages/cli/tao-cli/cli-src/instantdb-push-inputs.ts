import { ASTUtils } from '@ast-utils'
import { storedDataSchemaFile, type StoredDataSchemas } from '@compiler/stored-data-schema'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import type TR from '@runtime/TR'
import { Diagnostics, Errors, FS } from '@shared'
import type { TaoDataPolicy } from 'tao-instantdb/push'

/**
 * What `tao instantdb push` reads from a Tao app before it talks to InstantDB: which InstantDB app
 * the selected app's datasource names, the compiled schema of the store that datasource fills, and
 * the compiled access policy. The address is read statically, so a setting written as anything but a
 * literal is refused rather than guessed; the schema and policy are the compiler's own sidecars.
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
  const schemas = compiled.files.find(file => file.relativePath === storedDataSchemaFile)
  const address = instantAddress(
    app,
    stores,
    schemas === undefined ? { stores: {} } : JSON.parse(schemas.code) as StoredDataSchemas,
  )
  const policy = compiled.files.find(file => file.relativePath === policyFile)
  return {
    ...address,
    policy: policy === undefined ? undefined : JSON.parse(policy.code) as TaoDataPolicy,
  }
}

type InstantBinding = Readonly<{
  apiURI: string
  appId: string
  storeName: string | undefined
}>

/**
 * instantAddress finds the app's InstantDB datasource. Several bindings at one address are one push
 * of every store they fill; bindings at different addresses would need one push each, which this
 * command does not do yet.
 */
function instantAddress(
  app: AST.AppValueDeclaration,
  stores: ASTUtils.DataStorePlan,
  schemas: StoredDataSchemas,
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
  // The compiler writes a schema only for a synced store that holds data.
  const filled = [...new Set(bindings.flatMap(binding => binding.storeName ?? []))]
    .flatMap(name => schemas.stores[name] ?? [])
  if (filled.length === 0) {
    Errors.throwUserInput(`App '${app.name}' stores no data in its ${providerTypeName} datasource.`)
  }
  return {
    apiURI: bindings[0]!.apiURI,
    appId: bindings[0]!.appId,
    definition: {
      entities: Object.assign({}, ...filled.map(schema => schema.entities)),
      name: filled.map(schema => schema.name).join('+'),
      schemaVersion: 1,
    },
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
    storeName: (claims ? ASTUtils.storeOfDatasource(stores, declaration) : stores.defaultStore)?.name,
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
