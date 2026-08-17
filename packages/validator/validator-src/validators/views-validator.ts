import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { viewValidationCodes } from '../diagnostic-codes'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

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
  loopSelectPlacement: '`on select` must be a direct child of a loop.',
  loopSelectDuplicate: 'A loop may declare at most one `on select` handler.',
  loopSelectInline: '`on select` requires an inline action block.',
  renderTarget: '`render` must target a view or inject block.',
  renderInjectPlacement: '`render inject` must be the only statement in a view or layout body.',
  callerContentCount: (name: string) =>
    `Tao-authored layout or frame '${name}' must place caller content exactly once with @@content.`,
  callerContentPlacement: '@@content is only available inside the render tree of a layout or frame.',
  leafContent: (name: string) =>
    `Renderable '${name}' is a leaf and cannot accept unnamed caller content or named render slots.`,
  renderSlotDeclarationPlacement: 'A render slot must be declared directly in a frame body.',
  duplicateRenderSlot: (name: string) => `Render slot '${name}' is declared more than once in this frame.`,
  renderSlotPlacementCount: (name: string) =>
    `Frame render slot '${name}' must be placed exactly once in its render tree.`,
  renderSlotReferencePlacement: 'A bare render slot reference is only available in its owning frame render tree.',
  renderSlotFillPlacement: 'A render slot fill must be a direct child of an invocation of its owning frame.',
  duplicateRenderSlotFill: (name: string) => `Render slot '${name}' is filled more than once at this call site.`,
  tagAttachment: 'A #tag must be followed immediately by a render or loop in the same block.',
  duplicateTag: (tag: string) => `Duplicate ${tag} in the same block; a tag must be unique within its lexical block.`,
  taggedLoopRoot:
    'A tagged loop must contain exactly one unconditional direct row-root render; wrap the row in one view or layout.',
} as const

const reservedParameterNames = new Set(['children', 'key', 'ref', '__tao', '__taoSlots'])

/** ViewsValidator validates renderable declarations and render blocks. */
export const ViewsValidator = {
  checks: {
    [AST.VisualDeclaration.$type]: validateViewDeclaration,
    [AST.CallerContentStatement.$type]: validateCallerContentPlacement,
    [AST.LoopSelectHandler.$type]: validateLoopSelectHandler,
    [AST.RenderSlotDeclaration.$type]: validateRenderSlotDeclarationPlacement,
    [AST.RenderSlotUse.$type]: validateRenderSlotUse,
    [AST.TagStatement.$type]: validateTag,
  } satisfies NodeValidationChecks,
  messages: viewValidationMessages,
}

function validateLoopSelectHandler(handler: AST.LoopSelectHandler, ctx: ValidationContext): void {
  const loop = AST.directLoopForSelectHandler(handler)
  if (!loop) {
    ctx.error(viewValidationMessages.loopSelectPlacement, handler)
    return
  }
  if (handler.action || !handler.block) {
    ctx.error(viewValidationMessages.loopSelectInline, handler)
  }
  if (AST.loopSelectHandlers(loop).indexOf(handler) > 0) {
    ctx.error(viewValidationMessages.loopSelectDuplicate, handler)
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
  if (AST.isSlotFillRootTag(tag)) {
    return
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
  validateCallerContentContract(view, ctx)
  if (AST.isFrameDeclaration(view)) {
    validateFrameSlots(view, ctx)
  }
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
    FrameDeclaration: frame => validateFrameBodyBlock(frame.block, ctx),
    LayoutDeclaration: layout => validateLayoutBodyBlock(layout.block, ctx),
    DialogueDeclaration: dialogue => validateViewBodyBlock(dialogue.block, ctx),
    UiDeclaration: ui => validateViewBodyBlock(ui.block, ctx),
    ViewDeclaration: viewDeclaration => validateViewBodyBlock(viewDeclaration.block, ctx),
  })
}

function validateFrameBodyBlock(block: AST.Block, ctx: ValidationContext): void {
  for (const statement of block.statements) {
    if (AST.isRenderSlotDeclaration(statement)) {
      continue
    }
    if (AST.isAliasDeclaration(statement) || AST.isTagStatement(statement)) {
      continue
    }
    if (AST.isRenderStatement(statement)) {
      validateRender(statement, block, ctx)
      continue
    }
    ctx.error(viewValidationMessages.layoutBody, statement)
  }
}

function validateViewBodyBlock(block: AST.Block, ctx: ValidationContext): void {
  for (const statement of block.statements) {
    const isViewBodySetupStatement = AST.isAliasDeclaration(statement)
      || AST.isStateDeclaration(statement)
      || AST.isEntityQueryDeclaration(statement)
      || AST.isActionDeclaration(statement)
      || AST.isTagStatement(statement)
    if (isViewBodySetupStatement) {
      continue
    }
    if (AST.isRenderStatement(statement)) {
      validateRender(statement, block, ctx)
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
      validateRender(statement, block, ctx)
      continue
    }
    if (AST.isCallerContentStatement(statement)) {
      hasChildInvocation = true
      continue
    }
    if (AST.isRenderSlotUse(statement)) {
      hasChildInvocation = true
      if (statement.render) {
        validateRender(statement.render, block, ctx)
      }
      continue
    }
    if (AST.isEventHandler(statement)) {
      if (!AST.isRender(block.$container)) {
        ctx.error(viewValidationMessages.eventPlacement, statement)
      }
      continue
    }
    if (AST.isLoopSelectHandler(statement)) {
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
    if (AST.isIfRenderStatement(statement)) {
      hasChildInvocation = true
      validateRenderBlock(statement.block, ctx)
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
  render: AST.Render,
  owningBlock: AST.Block,
  ctx: ValidationContext,
): void {
  if (AST.isRenderStatement(render) && render.view === undefined && render.injection === undefined) {
    ctx.error(viewValidationMessages.renderTarget, render)
  }
  if (render.block) {
    validateRenderBlock(render.block, ctx)
    const target = render.view?.ref
    if (target && !AST.isLayoutDeclaration(target) && !AST.isFrameDeclaration(target)) {
      for (const statement of render.block.statements) {
        if (
          !AST.isEventHandler(statement)
          && !(AST.isTagStatement(statement) && AST.isSlotFillRootTag(statement))
        ) {
          ctx.error(viewValidationMessages.leafContent(target.name), statement)
        }
      }
    }
  }
  if (!AST.isRenderStatement(render) || render.injection === undefined) {
    return
  }
  const isSoleViewBodyStatement = AST.isVisualDeclaration(owningBlock.$container)
    && owningBlock.statements.length === 1
  if (!isSoleViewBodyStatement) {
    ctx.error(viewValidationMessages.renderInjectPlacement, render)
  }
}

function validateCallerContentContract(view: AST.VisualDeclaration, ctx: ValidationContext): void {
  if (!AST.isLayoutDeclaration(view) && !AST.isFrameDeclaration(view)) {
    return
  }
  const rootRender = view.block.statements.find(AST.isRenderStatement)
  if (!rootRender || rootRender.injection) {
    return
  }
  const count = AST.streamAllContents(rootRender).filter(AST.isCallerContentStatement).length
  if (count !== 1) {
    ctx.error(viewValidationMessages.callerContentCount(view.name), view)
  }
}

function validateCallerContentPlacement(content: AST.CallerContentStatement, ctx: ValidationContext): void {
  const owner = AST.findOwningView(content)
  if (!AST.isLayoutDeclaration(owner) && !AST.isFrameDeclaration(owner)) {
    ctx.error(viewValidationMessages.callerContentPlacement, content)
  }
}

function validateRenderSlotDeclarationPlacement(
  declaration: AST.RenderSlotDeclaration,
  ctx: ValidationContext,
): void {
  const block = declaration.$container
  if (!AST.isBlock(block) || !AST.isFrameDeclaration(block.$container) || block.$container.block !== block) {
    ctx.error(viewValidationMessages.renderSlotDeclarationPlacement, declaration)
  }
}

function validateFrameSlots(frame: AST.FrameDeclaration, ctx: ValidationContext): void {
  const declarations = AST.renderSlotDeclarationsOf(frame)
  const seen = new Set<string>()
  for (const declaration of declarations) {
    if (seen.has(declaration.name)) {
      ctx.error(viewValidationMessages.duplicateRenderSlot(declaration.name), declaration)
    }
    seen.add(declaration.name)

    const placements = AST.streamAllContents(frame)
      .filter(AST.isRenderSlotUse)
      .filter(use => !use.render && use.slot.$refText === declaration.name)
    if (placements.length !== 1) {
      ctx.error(viewValidationMessages.renderSlotPlacementCount(declaration.name), declaration)
    }
  }
}

function validateRenderSlotUse(use: AST.RenderSlotUse, ctx: ValidationContext): void {
  if (!use.render) {
    const owner = AST.findOwningView(use)
    const declaration = use.slot.ref
    const declarationBlock = declaration?.$container
    if (
      !AST.isFrameDeclaration(owner)
      || !AST.isBlock(declarationBlock)
      || declarationBlock.$container !== owner
    ) {
      ctx.error(viewValidationMessages.renderSlotReferencePlacement, use)
    }
    return
  }

  const block = use.$container
  const invocation = AST.isBlock(block) && AST.isRender(block.$container) ? block.$container : undefined
  const target = invocation?.view?.ref
  const declaration = use.slot.ref
  const declarationBlock = declaration?.$container
  const validOwner = AST.isFrameDeclaration(target)
    && AST.isBlock(declarationBlock)
    && declarationBlock.$container === target
  if (!validOwner) {
    ctx.error(viewValidationMessages.renderSlotFillPlacement, use)
  }
  if (AST.isBlock(block)) {
    const fills = AST.renderSlotUsesOf(block)
      .filter(candidate => candidate.render && candidate.slot.$refText === use.slot.$refText)
    if (fills.indexOf(use) > 0) {
      ctx.error(viewValidationMessages.duplicateRenderSlotFill(use.slot.$refText), use)
    }
  }
}
