import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { viewValidationCodes } from '../diagnostic-codes'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** viewValidationMessages declares structural diagnostics for Tao view bodies. */
const viewValidationMessages = {
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this view.`,
  reservedParameter: (name: string) => `Parameter name '${name}' is reserved for generated view props.`,
  renderCount: (name: string) => `View '${name}' must declare exactly one render statement.`,
  renderLast: '`render` must be the last statement in a view body.',
  viewBody:
    'Only supplied slots, let, state, query, action, command, slot, and render statements are allowed in view bodies.',
  renderBlock:
    'Only let, render, view invocation, event, when, guard, and loop statements are allowed in render child blocks.',
  renderBlockAliasPlacement: '`let` bindings in render blocks must be declared before child view invocations.',
  eventPlacement: '`on` event configuration must be a direct child of the view invocation it configures.',
  loopSelectPlacement: '`on select` must be a direct child of a loop.',
  loopSelectDuplicate: 'A loop may declare at most one `on select` handler.',
  loopSelectInline: '`on select` requires an inline action block.',
  renderTarget: '`render` must target a view or inject block.',
  renderInjectPlacement: '`render inject` must be the only statement in a view body.',
  foreignViewPath: 'A foreign view implementation path must name a relative TypeScript or TSX module.',
  foreignViewAccepts: '`accepts` must declare content, one or more named slots, or both.',
  callerContentCount: (name: string) => `View '${name}' may place caller content at most once with @@content.`,
  callerContentPlacement: '@@content is only available inside the render tree of a view.',
  leafContent: (name: string) => `View '${name}' places no @@content and cannot accept unnamed caller content.`,
  renderSlotDeclarationPlacement: 'A render slot must be declared directly in a view body.',
  duplicateRenderSlot: (name: string) => `Render slot '${name}' is declared more than once in this view.`,
  renderSlotPlacementCount: (name: string) =>
    `View render slot '${name}' must be placed exactly once in its render tree.`,
  renderSlotReferencePlacement: 'A bare render slot reference is only available in its owning view render tree.',
  renderSlotFillPlacement: 'A render slot fill must be a direct child of an invocation of its owning view.',
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
    [AST.ViewDeclaration.$type]: validateViewDeclaration,
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

function validateViewDeclaration(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  validateDuplicateParameters(view, ctx)
  validateRenderCount(view, ctx)
  validateRenderLast(view, ctx)
  if (view.block) {
    validateViewBodyBlock(view.block, ctx)
  }
  validateCallerContentContract(view, ctx)
  validateRenderSlots(view, ctx)
  validateForeignView(view, ctx)
}

function validateForeignView(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const foreign = view.foreign
  if (!foreign) {
    return
  }
  if (!/^\.\.?\/.+\.tsx?$/.test(foreign.path)) {
    ctx.error(viewValidationMessages.foreignViewPath, foreign)
  }
  if (foreign.accepts && foreign.content === undefined && foreign.slots.length === 0) {
    ctx.error(viewValidationMessages.foreignViewAccepts, foreign)
  }
  if (foreign.content !== undefined && foreign.content !== 'content') {
    ctx.error(viewValidationMessages.foreignViewAccepts, foreign)
  }
}

function validateDuplicateParameters(view: AST.ViewDeclaration, ctx: ValidationContext): void {
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

function validateRenderCount(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  // A pass-through alias renders whatever its target renders; it has no body of its own.
  if (view.aliasTarget || view.foreign) {
    return
  }
  const renderCount = AST.blockStatementOf(view, { filter: AST.isRenderStatement }).length
  if (renderCount !== 1) {
    ctx.error(viewValidationMessages.renderCount(view.name), view)
  }
}

function validateRenderLast(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const statements = AST.blockStatements(view)
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  if (renderIndex >= 0 && renderIndex !== statements.length - 1) {
    ctx.error(viewValidationMessages.renderLast, statements[renderIndex]!, {
      code: viewValidationCodes.renderNotLast,
    })
  }
}

// One body grammar for every view: what a view can do is inferred from what its body places, so no
// statement kind is reserved to a declaration kind.
function validateViewBodyBlock(block: AST.Block, ctx: ValidationContext): void {
  for (const statement of block.statements) {
    const isViewBodySetupStatement = AST.isAliasDeclaration(statement)
      || AST.isStateDeclaration(statement)
      || AST.isEntityQueryDeclaration(statement)
      || AST.isActionDeclaration(statement)
      || AST.isCommandDeclaration(statement)
      || AST.isDeclarationSlotFill(statement)
      || AST.isTagStatement(statement)
      || AST.isRenderSlotDeclaration(statement)
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
      for (const branch of ASTUtils.guardBranches(statement)) {
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
    // Content acceptance is inferred: a view accepts unnamed caller content iff its body places
    // @@content. Slot fills carry their own placement rule and are excluded here.
    if (target && !AST.viewPlacesCallerContent(target)) {
      for (const statement of render.block.statements) {
        if (
          !AST.isEventHandler(statement)
          && !(AST.isRenderSlotUse(statement) && statement.render)
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
  const isSoleViewBodyStatement = AST.isViewDeclaration(owningBlock.$container)
    && owningBlock.statements.length === 1
  if (!isSoleViewBodyStatement) {
    ctx.error(viewValidationMessages.renderInjectPlacement, render)
  }
}

// A view may place caller content at most once, and the placement may be conditional: while its
// branch is off, the caller's content does not mount. Placing none is what makes a view a leaf.
function validateCallerContentContract(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const rootRender = view.block?.statements.find(AST.isRenderStatement)
  if (!rootRender || rootRender.injection) {
    return
  }
  const placements = AST.streamAllContents(rootRender).filter(AST.isCallerContentStatement)
  for (const extra of placements.slice(1)) {
    ctx.error(viewValidationMessages.callerContentCount(view.name), extra)
  }
}

function validateCallerContentPlacement(content: AST.CallerContentStatement, ctx: ValidationContext): void {
  if (!AST.isViewDeclaration(AST.findOwningView(content))) {
    ctx.error(viewValidationMessages.callerContentPlacement, content)
  }
}

function validateRenderSlotDeclarationPlacement(
  declaration: AST.RenderSlotDeclaration,
  ctx: ValidationContext,
): void {
  const block = declaration.$container
  if (!AST.isBlock(block) || !AST.isViewDeclaration(block.$container) || block.$container.block !== block) {
    ctx.error(viewValidationMessages.renderSlotDeclarationPlacement, declaration)
  }
}

function validateRenderSlots(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const declarations = AST.renderSlotDeclarationsOf(view)
  const seen = new Set<string>()
  for (const declaration of declarations) {
    if (seen.has(declaration.name)) {
      ctx.error(viewValidationMessages.duplicateRenderSlot(declaration.name), declaration)
    }
    seen.add(declaration.name)

    if (view.foreign) {
      continue
    }
    const placements = AST.streamAllContents(view)
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
      !AST.isViewDeclaration(owner)
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
  const validOwner = AST.isViewDeclaration(target)
    && (
      (AST.isBlock(declarationBlock) && declarationBlock.$container === target)
      || (AST.isForeignViewImplementation(declarationBlock) && target.foreign === declarationBlock)
    )
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
