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
  viewBody: 'Only let, state, query, action, and render statements are allowed in view bodies.',
  layoutBody: 'Only let and render statements are allowed in layout bodies.',
  renderBlock:
    'Only let, render, view invocation, event, when, guard, and loop statements are allowed in render child blocks.',
  renderBlockAliasPlacement: '`let` bindings in render blocks must be declared before child view invocations.',
  eventPlacement: '`on` event configuration must be a direct child of the view invocation it configures.',
  renderTarget: '`render` must target a view or inject block.',
  renderInjectPlacement: '`render inject` must be the only statement in a view or layout body.',
  tagAttachment: 'A #tag must be followed immediately by a render or loop in the same block.',
  duplicateTag: (tag: string) => `Duplicate ${tag} in the same block; a tag must be unique within its lexical block.`,
  taggedLoopRoot:
    'A tagged loop must contain exactly one unconditional direct row-root render; wrap the row in one view or layout.',
} as const

const reservedParameterNames = new Set(['children', 'key', 'ref', '__tao'])

/** ViewsValidator validates renderable declarations and render blocks. */
export const ViewsValidator = {
  messages: viewValidationMessages,
  validate,
}

/** validateViews validates view declarations and view-body structure. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const view of AST.streamAllContents(file).filter(AST.isVisualDeclaration)) {
    validateViewDeclaration(view, ctx)
  }
  for (const tag of AST.streamAllContents(file).filter(AST.isTagStatement)) {
    validateTag(tag, ctx)
  }
}

function validateTag(tag: AST.TagStatement, ctx: ValidationContext): void {
  const block = tag.$container
  if (!AST.isBlock(block)) {
    ctx.error(viewValidationMessages.tagAttachment, tag)
    return
  }
  const duplicate = block.statements.some(statement =>
    statement !== tag && AST.isTagStatement(statement) && statement.tag === tag.tag
  )
  if (duplicate) {
    ctx.error(viewValidationMessages.duplicateTag(tag.tag), tag)
  }
  const index = block.statements.indexOf(tag)
  const target = block.statements[index + 1]
  if (!AST.isRender(target) && !AST.isForStatement(target)) {
    ctx.error(viewValidationMessages.tagAttachment, tag)
    return
  }
  if (AST.isForStatement(target) && !AST.taggedLoopRowRoot(target)) {
    ctx.error(viewValidationMessages.taggedLoopRoot, target)
  }
}

function validateViewDeclaration(view: AST.VisualDeclaration, ctx: ValidationContext): void {
  validateDuplicateParameters(view, ctx)
  validateRenderCount(view, ctx)
  validateRenderLast(view, ctx)
  validateRenderableBodyBlock(view, ctx)
}

function validateDuplicateParameters(view: AST.VisualDeclaration, ctx: ValidationContext): void {
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

function validateRenderCount(view: AST.VisualDeclaration, ctx: ValidationContext): void {
  const renderCount = AST.blockStatementOf(view, { filter: AST.isRenderStatement }).length
  if (renderCount !== 1) {
    ctx.error(viewValidationMessages.renderCount(view.name), view)
  }
}

function validateRenderLast(view: AST.VisualDeclaration, ctx: ValidationContext): void {
  const statements = AST.blockStatements(view)
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  if (renderIndex >= 0 && renderIndex !== statements.length - 1) {
    ctx.error(viewValidationMessages.renderLast, statements[renderIndex]!, {
      code: viewValidationCodes.renderNotLast,
    })
  }
}

function validateRenderableBodyBlock(view: AST.VisualDeclaration, ctx: ValidationContext): void {
  Switch.type(view, {
    LayoutDeclaration: layout => validateLayoutBodyBlock(layout.block, ctx),
    UiDeclaration: ui => validateViewBodyBlock(ui.block, ctx),
    ViewDeclaration: viewDeclaration => validateViewBodyBlock(viewDeclaration.block, ctx),
  })
}

function validateViewBodyBlock(block: AST.Block, ctx: ValidationContext): void {
  for (const statement of block.statements) {
    if (
      AST.isAliasDeclaration(statement)
      || AST.isStateDeclaration(statement)
      || AST.isEntityQueryDeclaration(statement)
      || AST.isActionDeclaration(statement)
      || AST.isTagStatement(statement)
    ) {
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
    if (AST.isTagStatement(statement)) {
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
    if (AST.isTagStatement(statement)) {
      continue
    }
    if (AST.isEntityQueryDeclaration(statement)) {
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
    if (AST.isEventHandler(statement)) {
      if (!AST.isRender(block.$container)) {
        ctx.error(viewValidationMessages.eventPlacement, statement)
      }
      continue
    }
    if (AST.isWhenRenderStatement(statement)) {
      hasChildInvocation = true
      for (const branch of statement.branches) {
        validateRenderBlock(branch.block, ctx)
      }
      validateRenderBlock(statement.otherwise.block, ctx)
      continue
    }
    if (AST.isGuardRenderStatement(statement)) {
      hasChildInvocation = true
      const branches = statement.caseBlock?.branches ?? (statement.single ? [statement.single] : [])
      for (const branch of branches) {
        if (branch.block) {
          validateRenderBlock(branch.block, ctx)
        }
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
  const isSoleViewBodyStatement = AST.isVisualDeclaration(owningBlock.$container)
    && owningBlock.statements.length === 1
  if (!isSoleViewBodyStatement) {
    ctx.error(viewValidationMessages.renderInjectPlacement, render)
  }
}
