import { type ASTUtils, Packages, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import type { ValidationContext } from '../validation'

/** appValidationMessages declares structural diagnostics for Tao app placement and configuration. */
const appValidationMessages = {
  topLevel:
    'Only project, app, ui, dialogue, view, layout, let, function, action, data, type, enum, test declarations, and use statements are allowed at file level.',
  appEntryFile: (name: string) => `App ${name} must be declared in the entry Tao file.`,
  appPackage: (name: string) => `App ${name} cannot be declared inside a package.`,
  appBlock: (name: string) => `App ${name} contains a statement that is not app configuration.`,
  duplicateDatasource: (name: string, data: string) => `App ${name} binds datasource ${data} more than once.`,
  appRootCount: (name: string, count: number) =>
    `App ${name} must declare exactly one Navigator (or transitional root view), found ${count}.`,
  rootViewParameters: (appName: string, viewName: string) =>
    `App ${appName} root view ${viewName} must not declare parameters.`,
  nameCount: (name: string, count: number) => `App ${name} must declare exactly one Name, found ${count}.`,
  navigatorType: (name: string, actual: string) => `App ${name} Navigator expects nav, got ${actual}.`,
  auxiliaryType: (name: string, key: string, actual: string) => `App ${name}@${key} expects nav, got ${actual}.`,
  duplicateAuxiliary: (name: string, key: string) => `App ${name} declares auxiliary navigator @${key} more than once.`,
  auxiliaryKey: (key: string) => `App auxiliary '${key}' must be a single @name key.`,
  datasourceType: (name: string) => `App ${name} Datasource expects a datasource configuration.`,
  datasourceCount: (name: string, count: number) => `App ${name} may declare at most one Datasource, found ${count}.`,
  propertyName: (expected: string, actual: string) => `App property '${actual}' must be spelled '${expected}'.`,
  variantProperty: (name: string, property: string) =>
    `App variant ${name} cannot patch unknown property '${property}'.`,
  variantDuplicate: (name: string, property: string) => `App variant ${name} patches '${property}' more than once.`,
  variantName: (name: string) => `App variant ${name} Name expects text.`,
  variantNavigator: (name: string, actual: string) => `App variant ${name} Navigator expects nav, got ${actual}.`,
  variantDatasource: (name: string) => `App variant ${name} Datasource expects a datasource configuration.`,
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
  for (const variant of file.statements.filter(AST.isAppVariantDeclaration)) {
    validateAppVariant(variant, ctx)
  }
}

function validateAppVariant(variant: AST.AppVariantDeclaration, ctx: ValidationContext): void {
  const entries = new Map<string, AST.ConfigurationEntry>()
  for (const entry of variant.value.patchBlock.entries) {
    if (!entry.name || !entry.value || !['Name', 'Navigator', 'Datasource'].includes(entry.name)) {
      ctx.error(appValidationMessages.variantProperty(variant.name, entry.name ?? entry.key ?? ''), entry)
      continue
    }
    if (entries.has(entry.name)) {
      ctx.error(appValidationMessages.variantDuplicate(variant.name, entry.name), entry)
    }
    entries.set(entry.name, entry)
  }
  const name = entries.get('Name')?.value
  if (name && !AST.isStringLiteral(name)) {
    ctx.error(appValidationMessages.variantName(variant.name), name)
  }
  const navigator = entries.get('Navigator')?.value
  if (navigator && !AST.isPropertyConfigurationPatch(navigator)) {
    const actual = configurationValueType(navigator)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(appValidationMessages.variantNavigator(variant.name, Type.displayName(actual)), navigator)
    }
  }
  const datasource = entries.get('Datasource')?.value
  if (datasource && !AST.isPropertyConfigurationPatch(datasource) && !configurationIsDatasource(datasource)) {
    ctx.error(appValidationMessages.variantDatasource(variant.name), datasource)
  }
}

function configurationValueType(value: AST.ConfigurationValue): ASTUtils.TaoType {
  if (AST.isConfigurationConstructor(value)) {
    return Type.ofConfiguredValue(value)
  }
  if (AST.isConfigurationReference(value)) {
    const target = value.target.ref
    if (AST.isTypeDeclaration(target)) {
      return Type.ofDefinition(target)
    }
    if (AST.isAliasDeclaration(target) || AST.isUiDeclaration(target)) {
      return Type.ofValueDeclaration(target)
    }
  }
  return { kind: 'unresolved' }
}

function configurationIsDatasource(value: AST.ConfigurationValue): boolean {
  if (AST.isConfigurationConstructor(value)) {
    return AST.isDatasourceDeclaration(value.type.ref)
  }
  if (AST.isConfigurationReference(value)) {
    const target = value.target.ref
    if (AST.isDatasourceDeclaration(target)) {
      return true
    }
    return AST.isAliasDeclaration(target) && configurationExpressionIsDatasource(target.value)
  }
  return false
}

function configurationExpressionIsDatasource(value: AST.Expression): boolean {
  if (AST.isConfigurationConstructor(value)) {
    return AST.isDatasourceDeclaration(value.type.ref)
  }
  if (AST.isValueReference(value)) {
    const target = value.target.ref
    return AST.isAliasDeclaration(target) && configurationExpressionIsDatasource(target.value)
  }
  return false
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

type AppStatements = readonly AST.OwnedBlockStatement[]

function validateAppDeclaration(app: AST.AppDeclaration, ctx: ValidationContext): void {
  const statements = AST.blockStatements(app)
  const modern = statements.some(statement => AST.isAppName(statement) || AST.isAppNavigator(statement))
  if (!modern) {
    validateLegacyApp(app, ctx)
    return
  }

  validateModernAppStatements(app, statements, ctx)
  validateAppNames(app, statements, ctx)
  validateAppNavigators(app, statements, ctx)
  validateAppAuxiliaryNavigators(app, statements, ctx)
  validateAppDatasources(app, statements, ctx)
}

function validateModernAppStatements(app: AST.AppDeclaration, statements: AppStatements, ctx: ValidationContext): void {
  for (const statement of statements) {
    const isModernAppConfigurationStatement = AST.isAppName(statement)
      || AST.isAppNavigator(statement)
      || AST.isAppAuxiliaryNavigator(statement)
      || AST.isAppDatasource(statement)
    if (!isModernAppConfigurationStatement) {
      ctx.error(appValidationMessages.appBlock(app.name), statement)
    }
  }
}

function validateAppNames(app: AST.AppDeclaration, statements: AppStatements, ctx: ValidationContext): void {
  const names = statements.filter(AST.isAppName)
  for (const name of names) {
    if (name.name !== 'Name') {
      ctx.error(appValidationMessages.propertyName('Name', name.name), name)
    }
  }
  if (names.length !== 1) {
    ctx.error(appValidationMessages.nameCount(app.name, names.length), app)
  }
}

function validateAppNavigators(app: AST.AppDeclaration, statements: AppStatements, ctx: ValidationContext): void {
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
    const actual = configuredAppPropertyType(navigator.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(appValidationMessages.navigatorType(app.name, Type.displayName(actual)), navigator)
    }
  }
}

function validateAppAuxiliaryNavigators(
  app: AST.AppDeclaration,
  statements: AppStatements,
  ctx: ValidationContext,
): void {
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
}

function validateAppDatasources(app: AST.AppDeclaration, statements: AppStatements, ctx: ValidationContext): void {
  const datasources = statements.filter(AST.isAppDatasource)
  if (datasources.length > 1) {
    ctx.error(appValidationMessages.datasourceCount(app.name, datasources.length), datasources[1]!)
  }
  for (const datasource of datasources) {
    if (datasource.name !== 'Datasource') {
      ctx.error(appValidationMessages.propertyName('Datasource', datasource.name ?? ''), datasource)
    }
    const target = datasource.value.target.ref
    const valid = AST.isDatasourceDeclaration(target)
      || (AST.isAliasDeclaration(target) && configurationExpressionIsDatasource(target.value))
    if (!valid) {
      ctx.error(appValidationMessages.datasourceType(app.name), datasource)
    }
  }
}

function configuredAppPropertyType(value: AST.ConfiguredAppPropertyValue): ASTUtils.TaoType {
  const target = value.target.ref
  if (AST.isNavDeclaration(target)) {
    return { kind: 'primitive', primitive: 'nav' }
  }
  if (AST.isDatasourceDeclaration(target)) {
    return { kind: 'item' }
  }
  if (AST.isTypeDeclaration(target)) {
    return Type.ofDefinition(target)
  }
  if (AST.isAliasDeclaration(target) || AST.isUiDeclaration(target)) {
    return Type.ofValueDeclaration(target)
  }
  return { kind: 'unresolved' }
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
