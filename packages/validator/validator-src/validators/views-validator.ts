import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import { viewValidationCodes } from '../diagnostic-codes'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** viewValidationMessages declares structural diagnostics for Tao view bodies. */
/** One phrasing of the one condition: a tag and a row label both need one native root to land on. */
const loopRowRootWording = 'exactly one unconditional direct row-root render; wrap the row in one view or layout.'

const viewValidationMessages = {
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this view.`,
  reservedParameter: (name: string) => `Parameter name '${name}' is reserved for generated view props.`,
  renderCount: (name: string) => `View '${name}' must declare exactly one render statement.`,
  renderLast: '`render` must be the last statement in a view body.',
  viewBody:
    'Only supplied slots, hide, let, state, query, action, command, slot, and render statements are allowed in view bodies.',
  renderBlock:
    'Only let, render, view invocation, event, when, guard, and loop statements are allowed in render child blocks.',
  renderBlockAliasPlacement: '`let` bindings in render blocks must be declared before child view invocations.',
  eventPlacement: '`on` event configuration must be a direct child of the view invocation it configures.',
  loopSelectPlacement: '`on select` must be a direct child of a loop.',
  loopSelectDuplicate: 'A loop may declare at most one `on select` handler.',
  loopSelectInline: '`on select` requires an inline action block.',
  renderTarget: '`render` must target a view or inject block.',
  sceneComposed: (name: string) => `Scene '${name}' is presented, never composed. Present it, or declare it as a view.`,
  sceneBoundToView: (scene: string, parameter: string) =>
    `Scene '${scene}' cannot be bound to view parameter '${parameter}'; a view renders it inline where no host reads its chrome.`,
  headerlessChrome: (name: string, slot: string) =>
    `Scene '${name}' fills Header false, so ${slot} would declare chrome nothing reads.`,
  renderInjectPlacement: '`render inject` must be the only statement in a view body.',
  foreignViewPath: 'A foreign view implementation path must name a relative TypeScript or TSX module.',
  foreignViewMissing: (path: string) => `Foreign view implementation '${path}' does not exist.`,
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
  taggedLoopRoot: `A tagged loop must contain ${loopRowRootWording}`,
  loopRowLabel: `A loop row carries no accessibility label unless the loop contains ${loopRowRootWording}`,
} as const

const reservedParameterNames = new Set(['children', 'key', 'ref', '__tao', '__taoSlots'])

/** ViewsValidator validates renderable declarations and render blocks. */
export const ViewsValidator = {
  checks: {
    [AST.ViewDeclaration.$type]: validateViewDeclaration,
    [AST.CallerContentStatement.$type]: validateCallerContentPlacement,
    [AST.ForStatement.$type]: validateLoopRowLabel,
    [AST.LoopSelectHandler.$type]: validateLoopSelectHandler,
    [AST.RenderSlotDeclaration.$type]: validateRenderSlotDeclarationPlacement,
    [AST.RenderSlotUse.$type]: validateRenderSlotUse,
    [AST.TagStatement.$type]: validateTag,
  } satisfies NodeValidationChecks,
  messages: viewValidationMessages,
  validateForeignFiles: validateForeignViewFiles,
}

/**
 * sceneSuppressesHeader reports a scene that statically opts out of header chrome with
 * `Header false`. Only the literal counts: the slot takes an ordinary reactive expression, and a
 * value that varies at runtime cannot make a fill dead.
 */
export function sceneSuppressesHeader(declaration: AST.ViewDeclaration): boolean {
  const fill = AST.declarationSlotFillNamed(declaration, 'Header')
  return fill?.value !== undefined && AST.isBooleanLiteral(fill.value) && fill.value.value === 'false'
}

/** validateHeaderlessChrome keeps a headerless scene from filling slots its host will never read. */
function validateHeaderlessChrome(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  if (!sceneSuppressesHeader(view)) {
    return
  }
  for (const slot of ['Title', 'Toolbar'] as const) {
    const fill = AST.declarationSlotFillNamed(view, slot)
    if (fill) {
      ctx.error(fill, viewValidationMessages.headerlessChrome(view.name, slot))
    }
  }
}

function validateLoopSelectHandler(handler: AST.LoopSelectHandler, ctx: ValidationContext): void {
  const loop = AST.directLoopForSelectHandler(handler)
  if (!loop) {
    ctx.error(handler, viewValidationMessages.loopSelectPlacement)
    return
  }
  if (handler.action || !handler.block) {
    ctx.error(handler, viewValidationMessages.loopSelectInline)
  }
  if (AST.loopSelectHandlers(loop).indexOf(handler) > 0) {
    ctx.error(handler, viewValidationMessages.loopSelectDuplicate)
  }
}

/**
 * validateLoopRowLabel points out a row whose derived label has nowhere to land. A selectable row
 * carries it on its press surface and a tagged loop already errors on the same condition, so the
 * hint is for the untagged, non-selectable, multi-root row that renders a row-bound text or
 * iterates a titled entity: it has a name a person would read, and the platform never hears it.
 */
function validateLoopRowLabel(loop: AST.ForStatement, ctx: ValidationContext): void {
  if (AST.attachedTag(loop) || AST.loopSelectHandlers(loop).length > 0 || AST.loopRowRoot(loop)) {
    return
  }
  const rowType = Type.ofValueDeclaration(loop)
  const titled = rowType.kind === 'entity' && Type.dataEntityTitleField(rowType.entity) !== undefined
  if (!titled && ASTUtils.outlineLoopDescriptor(loop).texts.length === 0) {
    return
  }
  ctx.hint(loop, viewValidationMessages.loopRowLabel)
}

function validateTag(tag: AST.TagStatement, ctx: ValidationContext): void {
  const block = tag.$container
  if (!AST.isBlock(block)) {
    ctx.error(tag, viewValidationMessages.tagAttachment)
    return
  }
  const duplicate = block.statements.some(statement =>
    statement !== tag && AST.isTagStatement(statement) && statement.tag === tag.tag
  )
  if (duplicate) {
    ctx.error(tag, viewValidationMessages.duplicateTag(tag.tag))
  }
  if (AST.isSlotFillRootTag(tag)) {
    return
  }
  const index = block.statements.indexOf(tag)
  const target = block.statements[index + 1]
  if (!AST.isRender(target) && !AST.isForStatement(target)) {
    ctx.error(tag, viewValidationMessages.tagAttachment)
    return
  }
  if (AST.isForStatement(target) && !AST.loopRowRoot(target)) {
    ctx.error(target, viewValidationMessages.taggedLoopRoot)
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
  validateHeaderlessChrome(view, ctx)
}

function validateForeignView(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const foreign = view.foreign
  if (!foreign) {
    return
  }
  if (!/^\.\.?\/.+\.tsx?$/.test(foreign.path)) {
    ctx.error(foreign, viewValidationMessages.foreignViewPath)
  }
  if (foreign.accepts && foreign.content === undefined && foreign.slots.length === 0) {
    ctx.error(foreign, viewValidationMessages.foreignViewAccepts)
  }
  if (foreign.content !== undefined && foreign.content !== 'content') {
    ctx.error(foreign, viewValidationMessages.foreignViewAccepts)
  }
}

async function validateForeignViewFiles(file: AST.TaoFile, ctx: ValidationContext): Promise<void> {
  for (const view of AST.streamAllContents(file).filter(AST.isViewDeclaration)) {
    const foreign = view.foreign
    if (!foreign || !/^\.\.?\/.+\.tsx?$/.test(foreign.path)) {
      continue
    }
    const documentDirectory = FS.resolvePath(FS.dirname(AST.getDocument(foreign).uri.path))
    if (
      await FS.isDirectory(documentDirectory)
      && !await FS.exists(FS.resolvePath(foreign.path, documentDirectory))
    ) {
      ctx.error(foreign, viewValidationMessages.foreignViewMissing(foreign.path))
    }
  }
}

function validateDuplicateParameters(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const parameter of AST.parametersOf(view)) {
    const name = Type.parameterName(parameter)
    if (reservedParameterNames.has(name)) {
      ctx.error(parameter, viewValidationMessages.reservedParameter(name))
    }
    if (seen.has(name)) {
      ctx.error(parameter, viewValidationMessages.duplicateParameter(name))
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
    ctx.error(view, viewValidationMessages.renderCount(view.name))
  }
}

function validateRenderLast(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const statements = AST.blockStatements(view)
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  if (renderIndex >= 0 && renderIndex !== statements.length - 1) {
    ctx.error(statements[renderIndex]!, viewValidationMessages.renderLast, {
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
      || AST.isViewCommandExclusion(statement)
      || AST.isTagStatement(statement)
      || AST.isRenderSlotDeclaration(statement)
    if (isViewBodySetupStatement) {
      continue
    }
    if (AST.isRenderStatement(statement)) {
      validateRender(statement, block, ctx)
      continue
    }
    ctx.error(statement, viewValidationMessages.viewBody)
  }
}

function validateRenderBlock(block: AST.Block, ctx: ValidationContext): void {
  let hasChildInvocation = false
  for (const statement of block.statements) {
    if (AST.isAliasDeclaration(statement)) {
      if (hasChildInvocation) {
        ctx.error(statement, viewValidationMessages.renderBlockAliasPlacement)
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
        ctx.error(statement, viewValidationMessages.eventPlacement)
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
    ctx.error(statement, viewValidationMessages.renderBlock)
  }
}

function validateRender(
  render: AST.Render,
  owningBlock: AST.Block,
  ctx: ValidationContext,
): void {
  if (AST.isRenderStatement(render) && render.view === undefined && render.injection === undefined) {
    ctx.error(render, viewValidationMessages.renderTarget)
  }
  // The one fact a scene carries that a body cannot state. Diagnosing it here, at the render site,
  // is what makes chrome nothing reads unrepresentable: a declaration that fills `Title` can never
  // end up composed inline where no host would read it. A nav is a scene by the Prelude and is the
  // one exception: it supplies its own chrome, so a render site may name it.
  const target = render.view?.ref
  const aliasTarget = AST.isViewDeclaration(target) ? AST.viewAliasTarget(target) : undefined
  const effectiveTarget = AST.isViewDeclaration(aliasTarget) ? aliasTarget : target
  if (AST.isViewDeclaration(effectiveTarget) && effectiveTarget.scene) {
    const renderedName = AST.isViewDeclaration(target) ? target.name : effectiveTarget.name
    ctx.error(render, viewValidationMessages.sceneComposed(renderedName))
  }
  // The same fact through a parameter: a scene handed to a `view`-typed slot is rendered inline by
  // the receiving view, so it is refused where it is bound rather than escaping the rule above.
  if (AST.isViewDeclaration(effectiveTarget) && !effectiveTarget.scene) {
    for (const pair of ASTUtils.resolveArgumentBindings(effectiveTarget, render).pairs) {
      const expected = Type.ofParameter(pair.parameter)
      const value = pair.argument.value
      if (expected.kind !== 'primitive' || expected.primitive !== 'view' || !AST.isValueReference(value)) {
        continue
      }
      const bound = value.target.ref
      if (AST.isViewDeclaration(bound) && bound.scene) {
        ctx.error(
          pair.argument,
          viewValidationMessages.sceneBoundToView(bound.name, Type.parameterName(pair.parameter)),
        )
      }
    }
  }
  if (render.block) {
    validateRenderBlock(render.block, ctx)
    // Content acceptance is inferred: a view accepts unnamed caller content iff its body places
    // @@content. Slot fills carry their own placement rule and are excluded here, and a nav or a
    // parameter takes no content at all, which the navigation validator reports.
    if (AST.isViewDeclaration(target) && !AST.viewPlacesCallerContent(target)) {
      for (const statement of render.block.statements) {
        if (
          !AST.isEventHandler(statement)
          && !(AST.isRenderSlotUse(statement) && statement.render)
          && !(AST.isTagStatement(statement) && AST.isSlotFillRootTag(statement))
        ) {
          ctx.error(statement, viewValidationMessages.leafContent(target.name))
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
    ctx.error(render, viewValidationMessages.renderInjectPlacement)
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
    ctx.error(extra, viewValidationMessages.callerContentCount(view.name))
  }
}

function validateCallerContentPlacement(content: AST.CallerContentStatement, ctx: ValidationContext): void {
  if (!AST.isViewDeclaration(AST.findOwningView(content))) {
    ctx.error(content, viewValidationMessages.callerContentPlacement)
  }
}

function validateRenderSlotDeclarationPlacement(
  declaration: AST.RenderSlotDeclaration,
  ctx: ValidationContext,
): void {
  const block = declaration.$container
  if (!AST.isBlock(block) || !AST.isViewDeclaration(block.$container) || block.$container.block !== block) {
    ctx.error(declaration, viewValidationMessages.renderSlotDeclarationPlacement)
  }
}

function validateRenderSlots(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  const declarations = AST.renderSlotDeclarationsOf(view)
  const seen = new Set<string>()
  for (const declaration of declarations) {
    if (seen.has(declaration.name)) {
      ctx.error(declaration, viewValidationMessages.duplicateRenderSlot(declaration.name))
    }
    seen.add(declaration.name)

    if (view.foreign) {
      continue
    }
    const placements = AST.streamAllContents(view)
      .filter(AST.isRenderSlotUse)
      .filter(use => !use.render && use.slot.$refText === declaration.name)
    if (placements.length !== 1) {
      ctx.error(declaration, viewValidationMessages.renderSlotPlacementCount(declaration.name))
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
      ctx.error(use, viewValidationMessages.renderSlotReferencePlacement)
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
    ctx.error(use, viewValidationMessages.renderSlotFillPlacement)
  }
  if (AST.isBlock(block)) {
    const fills = AST.renderSlotUsesOf(block)
      .filter(candidate => candidate.render && candidate.slot.$refText === use.slot.$refText)
    if (fills.indexOf(use) > 0) {
      ctx.error(use, viewValidationMessages.duplicateRenderSlotFill(use.slot.$refText))
    }
  }
}
