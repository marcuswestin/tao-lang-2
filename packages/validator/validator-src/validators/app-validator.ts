import { Packages, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import type { ValidationContext } from '../validation'

/** appValidationMessages declares structural diagnostics for Tao app placement and configuration. */
const appValidationMessages = {
  topLevel:
    'Only project, app, nav, datasource, ui, dialogue, view, layout, let, function, action, data, type, enum, test declarations, and use statements are allowed at file level.',
  appEntryFile: (name: string) => `App ${name} must be declared in the entry Tao file.`,
  appPackage: (name: string) => `App ${name} cannot be declared inside a package.`,
  appBlock: (name: string) => `App ${name} contains a statement that is not app configuration.`,
  appRootCount: (name: string, count: number) =>
    `App ${name} must declare exactly one Navigator (or transitional root view), found ${count}.`,
  rootViewParameters: (appName: string, viewName: string) =>
    `App ${appName} root view ${viewName} must not declare parameters.`,
  nameCount: (name: string, count: number) => `App ${name} must declare exactly one Name, found ${count}.`,
  auxiliaryType: (name: string, key: string, actual: string) => `App ${name}@${key} expects nav, got ${actual}.`,
  duplicateAuxiliary: (name: string, key: string) => `App ${name} declares auxiliary navigator @${key} more than once.`,
  auxiliaryKey: (key: string) => `App auxiliary '${key}' must be a single @name key.`,
  variantProperty: (name: string, property: string) =>
    `App variant ${name} cannot patch unknown property '${property}'.`,
  missingProperty: (name: string, property: string) => `App ${name} must supply '${property}'.`,
  propertyDuplicate: (name: string, property: string) => `App ${name} supplies '${property}' more than once.`,
  propertyType: (name: string, property: string, expected: string, actual: string) =>
    `App ${name} ${property} expects ${expected}, got ${actual}.`,
  headType: (name: string, actual: string) => `App head ${name} expects app, got ${actual}.`,
} as const

/** AppValidator validates Tao app placement and Prelude-owned supplied slots. */
export const AppValidator = {
  messages: appValidationMessages,
  validate,
}

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  validateTopLevelStatements(file, ctx)
  const apps = [
    ...file.statements.filter(AST.isAppDeclaration),
    ...AST.appValueDeclarationsInFile(file).filter(app => !AST.isAppDeclaration(app)),
  ]
  for (const app of apps) {
    validateAppPlacement(app, file, ctx)
    if (AST.isAppDeclaration(app)) {
      validateAppDeclaration(app, ctx)
    }
    if (app.value && AST.isRefinementExpression(app.value)) {
      validateAppVariant(app, app.value, ctx)
    }
  }
}

function validateAppDeclaration(app: AST.AppDeclaration, ctx: ValidationContext): void {
  if (app.value) {
    const actual = Type.ofExpression(app.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'app' })) {
      ctx.error(appValidationMessages.headType(app.name, Type.displayName(actual)), app.value)
    }
    return
  }
  const statements = AST.blockStatements(app)
  const properties = statements.filter(AST.isAppProperty)
  const roots = statements.filter(AST.isAppView)
  if (properties.length === 0 && roots.length > 0) {
    validateLegacyApp(app, ctx)
    return
  }
  for (const statement of statements) {
    if (!AST.isAppProperty(statement) && !AST.isAppAuxiliaryNavigator(statement)) {
      ctx.error(appValidationMessages.appBlock(app.name), statement)
    }
  }
  validateAppProperties(app.name, properties.map(suppliedSlotOfProperty), app, ctx, true)
  validateAppAuxiliaryNavigators(app, ctx)
}

/** SuppliedSlot names one app slot supplied either as an app property or as a variant patch entry. */
type SuppliedSlot = {
  readonly name: string
  readonly node: AST.Node
  readonly patched: boolean
  readonly value?: AST.Expression | AST.ConfigurationValue
}

function validateAppProperties(
  appName: string,
  supplied: readonly SuppliedSlot[],
  owner: AST.Node,
  ctx: ValidationContext,
  requireComplete: boolean,
): void {
  const contract = AST.primitiveSlots(ctx.workspaceFiles, 'app')
  const contractByName = new Map(contract.map(slot => [slot.name, slot]))
  const seen = new Set<string>()
  for (const slot of supplied) {
    const expected = contractByName.get(slot.name)
    if (!expected) {
      ctx.error(appValidationMessages.variantProperty(appName, slot.name), slot.node)
      continue
    }
    if (seen.has(slot.name)) {
      ctx.error(appValidationMessages.propertyDuplicate(appName, slot.name), slot.node)
    }
    seen.add(slot.name)
    if (!slot.value) {
      if (slot.patched && !requireComplete) {
        continue
      }
      ctx.error(
        appValidationMessages.propertyType(
          appName,
          slot.name,
          Type.displayName(Type.ofProperty(expected)),
          'patch',
        ),
        slot.node,
      )
      continue
    }
    // Configuration-only nodes carry no expression type; the owning configuration validator checks those.
    const actual = AST.isExpression(slot.value) ? Type.ofExpression(slot.value) : { kind: 'unresolved' as const }
    const expectedType = Type.ofProperty(expected)
    if (
      actual.kind !== 'unresolved' && expectedType.kind !== 'unresolved' && !Type.isAssignable(actual, expectedType)
    ) {
      ctx.error(
        appValidationMessages.propertyType(
          appName,
          slot.name,
          Type.displayName(expectedType),
          Type.displayName(actual),
        ),
        slot.value,
      )
    }
  }
  if (!requireComplete) {
    return
  }
  for (const required of contract.filter(Type.propertyRequiresValue)) {
    if (seen.has(required.name)) {
      continue
    }
    const node = supplied[0]?.node ?? owner
    if (required.name === 'Name') {
      ctx.error(appValidationMessages.nameCount(appName, 0), node)
    } else if (required.name === 'Navigator') {
      ctx.error(appValidationMessages.appRootCount(appName, 0), node)
    } else {
      ctx.error(appValidationMessages.missingProperty(appName, required.name), node)
    }
  }
}

function suppliedSlotOfProperty(property: AST.AppProperty): SuppliedSlot {
  return { name: property.name, node: property, patched: property.patch !== undefined, value: property.value }
}

function validateAppVariant(
  variant: AST.AppValueDeclaration,
  refinement: AST.RefinementExpression,
  ctx: ValidationContext,
): void {
  const supplied = refinement.patchBlock.entries.flatMap<SuppliedSlot>(entry => {
    if (!entry.name) {
      ctx.error(appValidationMessages.variantProperty(variant.name, entry.key ?? ''), entry)
      return []
    }
    const patched = entry.value !== undefined && AST.isPropertyConfigurationPatch(entry.value)
    return [{
      name: entry.name,
      node: entry,
      patched,
      value: patched ? undefined : entry.value,
    }]
  })
  validateAppProperties(variant.name, supplied, variant, ctx, false)
}

function validateAppAuxiliaryNavigators(app: AST.AppDeclaration, ctx: ValidationContext): void {
  const auxiliaryKeys = new Set<string>()
  for (const auxiliary of AST.blockStatements(app).filter(AST.isAppAuxiliaryNavigator)) {
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

function validateLegacyApp(app: AST.AppDeclaration, ctx: ValidationContext): void {
  for (const statement of AST.blockStatements(app)) {
    if (!AST.isAppView(statement)) {
      ctx.error(appValidationMessages.appBlock(app.name), statement)
    }
  }
  const roots = AST.blockStatements(app).filter(AST.isAppView)
  if (roots.length !== 1) {
    ctx.error(appValidationMessages.appRootCount(app.name, roots.length), app)
  }
  for (const root of roots) {
    if (root.view.ref && AST.parametersOf(root.view.ref).length > 0) {
      ctx.error(appValidationMessages.rootViewParameters(app.name, root.view.ref.name), root)
    }
  }
}

function validateAppPlacement(app: AST.AppValueDeclaration, file: AST.TaoFile, ctx: ValidationContext): void {
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

function isInsidePackage(filePath: string, ctx: ValidationContext): boolean {
  for (const packagePaths of ctx.packagesContext.index.packages.values()) {
    if (packagePaths.some(packagePath => pathIsWithin(filePath, packagePath))) {
      return true
    }
  }
  return false
}

// A test sidecar runs an app declared elsewhere in the project. That file is its own directory's
// entry when the tests sit beside it, and an ancestor's once the sources are grouped into folders,
// so reachability is what this allows rather than an exact directory match.
function isTestCompanionAppFile(filePath: string, ctx: ValidationContext): boolean {
  if (!Packages.isTestSourcePath(ctx.entryFilePath)) {
    return false
  }
  const testDirectory = FS.dirname(ctx.entryFilePath)
  const appDirectory = FS.dirname(filePath)
  const relative = FS.relativePath(appDirectory, testDirectory)
  return relative === '' || !relative.startsWith('..')
}

function pathIsWithin(path: string, directoryPath: string): boolean {
  const relative = FS.relativePath(directoryPath, path)
  return relative === '' || (!relative.startsWith('..') && relative !== '..')
}
