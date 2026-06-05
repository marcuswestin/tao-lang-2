import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** viewValidationMessages declares structural diagnostics for Tao ui bodies. */
export const viewValidationMessages = {
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this ui.`,
  renderCount: (name: string) => `ui '${name}' must declare exactly one render statement.`,
  viewBody: 'Only alias and render statements are allowed in ui bodies.',
  renderTarget: '`render` must target a ui or inject block.',
  renderInjectPlacement: '`render inject` must be the only statement in a ui body.',
} as const

/** validateViews validates ui declarations and ui-body structure. */
export function validateViews(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const view of ASTUtils.streamAllContents(file).filter(AST.isViewDeclaration)) {
    validateViewDeclaration(view, ctx)
  }
}

function validateViewDeclaration(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  validateDuplicateParameters(view, ctx)
  validateRenderCount(view, ctx)
  validateViewBlock(view.block, ctx, true)
}

function validateDuplicateParameters(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const parameter of view.parameterList?.parameters ?? []) {
    if (seen.has(parameter.name)) {
      ctx.error(viewValidationMessages.duplicateParameter(parameter.name), parameter)
      continue
    }
    seen.add(parameter.name)
  }
}

function validateRenderCount(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const renderCount = view.block.statements.filter(AST.isRender).length
  if (renderCount !== 1) {
    ctx.error(viewValidationMessages.renderCount(view.name), view)
  }
}

function validateViewBlock(block: AST.Block, ctx: ValidationContext, allowAliases: boolean): void {
  for (const statement of block.statements) {
    if (allowAliases && AST.isAliasDeclaration(statement)) {
      continue
    }
    if (AST.isRender(statement)) {
      validateRender(statement, block, ctx)
      if (statement.block) {
        validateViewBlock(statement.block, ctx, false)
      }
      continue
    }
    ctx.error(viewValidationMessages.viewBody, statement)
  }
}

function validateRender(render: AST.Render, owningBlock: AST.Block, ctx: ValidationContext): void {
  if (render.view === undefined && render.injection === undefined) {
    ctx.error(viewValidationMessages.renderTarget, render)
  }
  if (render.injection === undefined) {
    return
  }
  const isSoleViewBodyStatement = AST.isViewDeclaration(owningBlock.$container) && owningBlock.statements.length === 1
  if (!isSoleViewBodyStatement) {
    ctx.error(viewValidationMessages.renderInjectPlacement, render)
  }
}
