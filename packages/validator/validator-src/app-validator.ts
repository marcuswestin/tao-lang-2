import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** appValidationMessages declares structural diagnostics for Tao app placement. */
export const appValidationMessages = {
  topLevel: 'Only app, ui, layout, alias declarations, and use statements are allowed at file level.',
  appCount: (count: number) => `Tao file must declare at most one app, found ${count}.`,
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
    validateAppDeclaration(app, ctx)
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
