import { ASTUtils } from '@ast-utils'
import { storedDataSchemaFile, type StoredDataSchemas } from '@compiler/stored-data-schema'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import type TR from '@runtime/TR'
import { Diagnostics, Errors, FS } from '@shared'
import type { TaoDataPolicy } from 'tao-jazz/deployment'

export type HostedProvider = 'jazz' | 'convex' | 'pylon' | 'firebase'

export type HostedProviderInputs = Readonly<{
  definition: TR.DataSchemaDefinition
  policy: TaoDataPolicy | undefined
}>

const providerTypeNames: Readonly<Record<HostedProvider, string>> = {
  convex: 'Convex',
  firebase: 'Firebase',
  jazz: 'Jazz',
  pylon: 'Pylon',
}

/** Read the compiled store and policy for the selected app's hosted datasource. */
export async function readHostedProviderInputs(
  appPath: string,
  appName: string,
  provider: HostedProvider,
): Promise<HostedProviderInputs> {
  const workspace = await Workspace.open(FS.dirname(appPath))
  const validation = await workspace.validate(appPath)
  if (Diagnostics.hasError(validation.diagnostics)) {
    Errors.throwUserInput(
      [
        `${FS.displayPath(appPath)} has errors; fix them before generating (\`tao check\` lists them):`,
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
  const typeName = providerTypeNames[provider]
  const bindings = ASTUtils.appBoundDatasources(app).flatMap(binding => {
    const value = binding.value ?? binding.declaration?.value
    if (value === undefined || AST.isAppView(value)) {
      return []
    }
    const resolved = ASTUtils.resolveDatasourceValue(value, binding.patches)
    if (!resolved.typeNames.includes(typeName)) {
      return []
    }
    const declaration = binding.declaration
    const store = declaration !== undefined && ASTUtils.datasourceCollectionNames(declaration) !== undefined
      ? ASTUtils.storeOfDatasource(stores, declaration)
      : stores.defaultStore
    return store === undefined ? [] : [store.name]
  })
  if (bindings.length === 0) {
    Errors.throwUserInput(`App '${appName}' binds no ${typeName} datasource with a store to generate.`)
  }
  const storeNames = [...new Set(bindings)]
  if (storeNames.length !== 1) {
    Errors.throwUserInput(
      `App '${appName}' binds ${typeName} datasources for ${storeNames.length} stores; generate supports one store.`,
    )
  }
  const schemaFile = compiled.files.find(file => file.relativePath === storedDataSchemaFile)
  const schemas: StoredDataSchemas = schemaFile === undefined ? { stores: {} } : JSON.parse(schemaFile.code)
  const definition = schemas.stores[storeNames[0]!]
  if (definition === undefined || Object.keys(definition.entities).length === 0) {
    Errors.throwUserInput(`App '${appName}' stores no data in its ${typeName} datasource.`)
  }
  const policyFile = compiled.files.find(file => file.relativePath === 'TaoDataPolicy.json')
  if (policyFile === undefined && provider !== 'firebase') {
    Errors.throwUserInput(
      `App '${appName}' has no compiled access policy; declare access rules before generating ${typeName} backend files.`,
    )
  }
  return { definition, policy: policyFile === undefined ? undefined : JSON.parse(policyFile.code) as TaoDataPolicy }
}
