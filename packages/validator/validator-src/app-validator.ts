import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** appValidationMessages declares structural diagnostics for Tao app placement. */
export const appValidationMessages = {
  topLevel: 'Only app, ui, and alias declarations are allowed at file level.',
  appCount: (count: number) => `Tao file must declare exactly one app, found ${count}.`,
  appBlock: (name: string) => `Only root ui declarations are allowed in app ${name}.`,
  appRootCount: (name: string, count: number) => `App ${name} must declare exactly one root ui, found ${count}.`,
} as const

/** validateApp validates file-level and app-block structure. */
export function validateApp(file: AST.TaoFile, ctx: ValidationContext): void {
  validateTopLevelStatements(file, ctx)

  const apps = file.statements.filter(AST.isAppDeclaration)
  if (apps.length !== 1) {
    ctx.error(appValidationMessages.appCount(apps.length), file)
  }

  for (const app of apps) {
    validateAppDeclaration(app, ctx)
  }
}

function validateTopLevelStatements(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const statement of file.statements) {
    if (AST.isAppDeclaration(statement) || AST.isViewDeclaration(statement) || AST.isAliasDeclaration(statement)) {
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
}
