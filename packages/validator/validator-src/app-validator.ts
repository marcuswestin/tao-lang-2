import { Packages, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import type { ValidationContext } from './validation'

/** appValidationMessages declares structural diagnostics for Tao app placement and configuration. */
const appValidationMessages = {
  topLevel:
    'Only project, app, ui, view, layout, let, function, action, data, type, test declarations, and use statements are allowed at file level.',
  appEntryFile: (name: string) => `App ${name} must be declared in the entry Tao file.`,
  appPackage: (name: string) => `App ${name} cannot be declared inside a package.`,
  appBlock: (name: string) => `App ${name} contains a statement that is not app configuration.`,
  duplicateDatasource: (name: string, data: string) => `App ${name} binds datasource ${data} more than once.`,
  unknownProvider: (provider: string) =>
    `Unknown datasource provider '${provider}'. Supported providers: Local, Memory.`,
  appRootCount: (name: string, count: number) =>
    `App ${name} must declare exactly one Navigator (or transitional root view), found ${count}.`,
  rootViewParameters: (appName: string, viewName: string) =>
    `App ${appName} root view ${viewName} must not declare parameters.`,
  nameCount: (name: string, count: number) => `App ${name} must declare exactly one Name, found ${count}.`,
  navigatorType: (name: string, actual: string) => `App ${name} Navigator expects nav, got ${actual}.`,
  auxiliaryType: (name: string, key: string, actual: string) => `App ${name}@${key} expects nav, got ${actual}.`,
  duplicateAuxiliary: (name: string, key: string) => `App ${name} declares auxiliary navigator @${key} more than once.`,
  auxiliaryKey: (key: string) => `App auxiliary '${key}' must be a single @name key.`,
  datasourceType: (name: string) => `App ${name} Datasource expects Local or Memory configuration.`,
  datasourceCount: (name: string, count: number) => `App ${name} may declare at most one Datasource, found ${count}.`,
  propertyName: (expected: string, actual: string) => `App property '${actual}' must be spelled '${expected}'.`,
} as const

/** AppValidator validates Tao app placement and structure. */
export const AppValidator = {
  messages: appValidationMessages,
  validate,
}

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  validateTopLevelStatements(file, ctx)
  for (const app of file.statements.filter(AST.isAppDeclaration)) {
    validateAppPlacement(app, file, ctx)
    validateAppDeclaration(app, ctx)
  }
}

function validateAppPlacement(app: AST.AppDeclaration, file: AST.TaoFile, ctx: ValidationContext): void {
  const filePath = AST.getDocument(file).uri.path
  if (isInsidePackage(filePath, ctx)) {
    ctx.error(appValidationMessages.appPackage(app.name), app)
    return
  }
  if (filePath !== ctx.entryFilePath && !isTestCompanionAppFile(filePath, ctx)) {
    ctx.error(appValidationMessages.appEntryFile(app.name), app)
  }
}

function validateTopLevelStatements(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const statement of file.statements) {
    if (!AST.isTopLevelStatement(statement)) {
      ctx.error(appValidationMessages.topLevel, statement)
    }
  }
}

function validateAppDeclaration(app: AST.AppDeclaration, ctx: ValidationContext): void {
  const statements = AST.blockStatements(app)
  const modern = statements.some(statement => AST.isAppName(statement) || AST.isAppNavigator(statement))
  if (!modern) {
    validateLegacyApp(app, ctx)
    return
  }

  for (const statement of statements) {
    if (
      !AST.isAppName(statement)
      && !AST.isAppNavigator(statement)
      && !AST.isAppAuxiliaryNavigator(statement)
      && !AST.isAppDatasource(statement)
    ) {
      ctx.error(appValidationMessages.appBlock(app.name), statement)
    }
  }

  const names = statements.filter(AST.isAppName)
  for (const name of names) {
    if (name.name !== 'Name') {
      ctx.error(appValidationMessages.propertyName('Name', name.name), name)
    }
  }
  if (names.length !== 1) {
    ctx.error(appValidationMessages.nameCount(app.name, names.length), app)
  }

  const navigators = statements.filter(AST.isAppNavigator)
  for (const navigator of navigators) {
    if (navigator.name !== 'Navigator') {
      ctx.error(appValidationMessages.propertyName('Navigator', navigator.name), navigator)
    }
  }
  if (navigators.length !== 1) {
    ctx.error(appValidationMessages.appRootCount(app.name, navigators.length), app)
  }
  for (const navigator of navigators) {
    const actual = Type.ofExpression(navigator.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(appValidationMessages.navigatorType(app.name, Type.displayName(actual)), navigator)
    }
  }

  const auxiliaryKeys = new Set<string>()
  for (const auxiliary of statements.filter(AST.isAppAuxiliaryNavigator)) {
    const key = auxiliary.name.slice(1)
    if (!/^@[A-Za-z_][A-Za-z0-9_]*$/.test(auxiliary.name)) {
      ctx.error(appValidationMessages.auxiliaryKey(auxiliary.name), auxiliary)
    }
    if (auxiliaryKeys.has(key)) {
      ctx.error(appValidationMessages.duplicateAuxiliary(app.name, key), auxiliary)
    }
    auxiliaryKeys.add(key)
    const actual = Type.ofExpression(auxiliary.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(appValidationMessages.auxiliaryType(app.name, key, Type.displayName(actual)), auxiliary)
    }
  }

  const datasources = statements.filter(AST.isAppDatasource)
  if (datasources.length > 1) {
    ctx.error(appValidationMessages.datasourceCount(app.name, datasources.length), datasources[1]!)
  }
  for (const datasource of datasources) {
    if (datasource.name !== 'Datasource') {
      ctx.error(appValidationMessages.propertyName('Datasource', datasource.name ?? ''), datasource)
    }
    if (!datasource.value || !AST.isConfiguredValue(datasource.value)) {
      ctx.error(appValidationMessages.datasourceType(app.name), datasource)
      continue
    }
    const provider = datasource.value.type.ref?.name
    if (provider !== 'Local' && provider !== 'Memory') {
      ctx.error(appValidationMessages.datasourceType(app.name), datasource)
    }
  }
}

function validateLegacyApp(app: AST.AppDeclaration, ctx: ValidationContext): void {
  for (const statement of AST.blockStatements(app)) {
    if (AST.isAppView(statement)) {
      continue
    }
    ctx.error(appValidationMessages.appBlock(app.name), statement)
  }

  const roots = AST.blockStatements(app).filter(AST.isAppView)
  if (roots.length !== 1) {
    ctx.error(appValidationMessages.appRootCount(app.name, roots.length), app)
  }
  for (const root of roots) {
    if (AST.isAppView(root) && root.view.ref && AST.parametersOf(root.view.ref).length > 0) {
      ctx.error(appValidationMessages.rootViewParameters(app.name, root.view.ref.name), root)
    }
  }
}

function isInsidePackage(filePath: string, ctx: ValidationContext): boolean {
  for (const packagePaths of ctx.packagesContext.index.packages.values()) {
    if (packagePaths.some(packagePath => pathIsWithin(filePath, packagePath))) {
      return true
    }
  }
  return false
}

function isTestCompanionAppFile(filePath: string, ctx: ValidationContext): boolean {
  return Packages.isTestSourcePath(ctx.entryFilePath) && FS.dirname(filePath) === FS.dirname(ctx.entryFilePath)
}

function pathIsWithin(path: string, directoryPath: string): boolean {
  const relative = FS.relativePath(directoryPath, path)
  return relative === '' || (!relative.startsWith('..') && relative !== '..')
}
