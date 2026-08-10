import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { viewValidationCodes } from './diagnostic-codes'
import type { ValidationContext } from './validation'

/** viewValidationMessages declares structural diagnostics for Tao view bodies. */
const viewValidationMessages = {
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this view.`,
  reservedParameter: (name: string) => `Parameter name '${name}' is reserved for generated view props.`,
  renderCount: (name: string) => `Renderable declaration '${name}' must declare exactly one render statement.`,
  renderLast: '`render` must be the last statement in a view or layout body.',
  viewBody: 'Only alias, state, action, and render statements are allowed in view bodies.',
  layoutBody: 'Only alias and render statements are allowed in layout bodies.',
  renderBlock: 'Only alias, render, view invocation, if, and for statements are allowed in render child blocks.',
  renderBlockAliasPlacement: 'Aliases in render blocks must be declared before child view invocations.',
  renderTarget: '`render` must target a view or inject block.',
  renderInjectPlacement: '`render inject` must be the only statement in a view or layout body.',
} as const

const reservedParameterNames = new Set(['children', 'key', 'ref', '__tao'])

/** ViewsValidator validates renderable declarations and render blocks. */
export const ViewsValidator = {
  messages: viewValidationMessages,
  validate,
}

/** validateViews validates view declarations and view-body structure. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const view of AST.streamAllContents(file).filter(AST.isRenderableDeclaration)) {
    validateViewDeclaration(view, ctx)
  }
}

function validateViewDeclaration(view: AST.RenderableDeclaration, ctx: ValidationContext): void {
  validateDuplicateParameters(view, ctx)
  validateRenderCount(view, ctx)
  validateRenderLast(view, ctx)
  validateRenderableBodyBlock(view, ctx)
}

function validateDuplicateParameters(view: AST.RenderableDeclaration, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const parameter of AST.parametersOf(view)) {
    const name = Type.parameterName(parameter)
    if (reservedParameterNames.has(name)) {
      ctx.error(viewValidationMessages.reservedParameter(name), parameter)
    }
    if (seen.has(name)) {
      ctx.error(viewValidationMessages.duplicateParameter(name), parameter)
      continue
    }
    seen.add(name)
  }
}

function validateRenderCount(view: AST.RenderableDeclaration, ctx: ValidationContext): void {
  const renderCount = AST.blockStatementOf(view, { filter: AST.isRenderStatement }).length
  if (renderCount !== 1) {
    ctx.error(viewValidationMessages.renderCount(view.name), view)
  }
}

function validateRenderLast(view: AST.RenderableDeclaration, ctx: ValidationContext): void {
  const statements = AST.blockStatements(view)
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  if (renderIndex >= 0 && renderIndex !== statements.length - 1) {
    ctx.error(viewValidationMessages.renderLast, statements[renderIndex]!, {
      code: viewValidationCodes.renderNotLast,
    })
  }
}

function validateRenderableBodyBlock(view: AST.RenderableDeclaration, ctx: ValidationContext): void {
  Switch.type(view, {
    LayoutDeclaration: layout => validateLayoutBodyBlock(layout.block, ctx),
    ViewDeclaration: viewDeclaration => validateViewBodyBlock(viewDeclaration.block, ctx),
  })
}

function validateViewBodyBlock(block: AST.Block, ctx: ValidationContext): void {
  for (const statement of block.statements) {
    if (AST.isAliasDeclaration(statement) || AST.isStateDeclaration(statement) || AST.isActionDeclaration(statement)) {
      continue
    }
    if (AST.isRenderStatement(statement)) {
      validateRender(statement, block, ctx)
      if (statement.block) {
        validateRenderBlock(statement.block, ctx)
      }
      continue
    }
    ctx.error(viewValidationMessages.viewBody, statement)
  }
}

function validateLayoutBodyBlock(block: AST.Block, ctx: ValidationContext): void {
  for (const statement of block.statements) {
    if (AST.isAliasDeclaration(statement)) {
      continue
    }
    if (AST.isRenderStatement(statement)) {
      validateRender(statement, block, ctx)
      if (statement.block) {
        validateRenderBlock(statement.block, ctx)
      }
      continue
    }
    ctx.error(viewValidationMessages.layoutBody, statement)
  }
}

function validateRenderBlock(block: AST.Block, ctx: ValidationContext): void {
  let hasChildInvocation = false
  for (const statement of block.statements) {
    if (AST.isAliasDeclaration(statement)) {
      if (hasChildInvocation) {
        ctx.error(viewValidationMessages.renderBlockAliasPlacement, statement)
      }
      continue
    }
    if (AST.isRender(statement)) {
      hasChildInvocation = true
      if (AST.isRenderStatement(statement)) {
        validateRender(statement, block, ctx)
      }
      if (statement.block) {
        validateRenderBlock(statement.block, ctx)
      }
      continue
    }
    if (AST.isIfStatement(statement)) {
      hasChildInvocation = true
      validateRenderBlock(statement.thenBlock, ctx)
      if (statement.elseBlock) {
        validateRenderBlock(statement.elseBlock, ctx)
      }
      continue
    }
    if (AST.isForStatement(statement)) {
      hasChildInvocation = true
      validateRenderBlock(statement.block, ctx)
      continue
    }
    ctx.error(viewValidationMessages.renderBlock, statement)
  }
}

function validateRender(
  render: AST.RenderStatement,
  owningBlock: AST.Block,
  ctx: ValidationContext,
): void {
  if (render.view === undefined && render.injection === undefined) {
    ctx.error(viewValidationMessages.renderTarget, render)
  }
  if (render.injection === undefined) {
    return
  }
  const isSoleViewBodyStatement = AST.isRenderableDeclaration(owningBlock.$container)
    && owningBlock.statements.length === 1
  if (!isSoleViewBodyStatement) {
    ctx.error(viewValidationMessages.renderInjectPlacement, render)
  }
}
