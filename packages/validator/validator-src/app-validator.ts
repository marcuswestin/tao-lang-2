import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import type { ValidationContext } from './validation'

/** appValidationMessages declares structural diagnostics for Tao app placement. */
export const appValidationMessages = {
  topLevel: 'Only project, app, ui, layout, alias declarations, and use statements are allowed at file level.',
  appCount: (count: number) => `Tao file must declare at most one app, found ${count}.`,
  appEntryFile: (name: string) => `App ${name} must be declared in the entry Tao file.`,
  appPackage: (name: string) => `App ${name} cannot be declared inside a package.`,
  appBlock: (name: string) => `Only root ui declarations are allowed in app ${name}.`,
  appRootCount: (name: string, count: number) => `App ${name} must declare exactly one root ui, found ${count}.`,
  rootUiParameters: (appName: string, uiName: string) =>
    `App ${appName} root ui ${uiName} must not declare parameters.`,
} as const

/** validateApp validates file-level and app-block structure. */
export function validateApp(file: AST.TaoFile, ctx: ValidationContext): void {
  validateTopLevelStatements(file, ctx)

  const apps = file.statements.filter(AST.isAppDeclaration)
  if (apps.length > 1) {
    ctx.error(appValidationMessages.appCount(apps.length), file)
  }

  for (const app of apps) {
    validateAppPlacement(app, file, ctx)
    validateAppDeclaration(app, ctx)
  }
}

function validateAppPlacement(app: AST.AppDeclaration, file: AST.TaoFile, ctx: ValidationContext): void {
  const filePath = ASTUtils.getDocument(file).uri.path
  if (isInsidePackage(filePath, ctx)) {
    ctx.error(appValidationMessages.appPackage(app.name), app)
    return
  }
  if (filePath !== ctx.entryFilePath) {
    ctx.error(appValidationMessages.appEntryFile(app.name), app)
  }
}

function validateTopLevelStatements(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const statement of file.statements) {
    if (AST.isTopLevelStatement(statement)) {
      continue
    }
    ctx.error(appValidationMessages.topLevel, statement)
  }
}

function validateAppDeclaration(app: AST.AppDeclaration, ctx: ValidationContext): void {
  for (const statement of app.block.statements) {
    if (AST.isAppUi(statement)) {
      continue
    }
    ctx.error(appValidationMessages.appBlock(app.name), statement)
  }

  const roots = app.block.statements.filter(AST.isAppUi)
  if (roots.length !== 1) {
    ctx.error(appValidationMessages.appRootCount(app.name, roots.length), app)
  }
  for (const root of roots) {
    validateRootUi(app, root, ctx)
  }
}

function validateRootUi(app: AST.AppDeclaration, root: AST.AppUi, ctx: ValidationContext): void {
  const ui = root.ui.ref
  if (!ui) {
    return
  }
  if ((ui.parameterList?.parameters.length ?? 0) > 0) {
    ctx.error(appValidationMessages.rootUiParameters(app.name, ui.name), root)
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

function pathIsWithin(path: string, directoryPath: string): boolean {
  const relative = FS.relativePath(directoryPath, path)
  return relative === '' || (!relative.startsWith('..') && relative !== '..')
}
