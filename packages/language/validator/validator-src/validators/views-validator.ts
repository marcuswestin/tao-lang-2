import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import { viewValidationCodes } from '../diagnostic-codes'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { RendererSlotsValidationMessages as rendererSlotMessages } from './RendererSlotsValidationMessages'

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
  bareRenderTargetType: (name: string, actual: string) =>
    `Bare render target '${name}' must have type text or rendered, or satisfy ui, got ${actual}.`,
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
<<<<<<< HEAD
  duplicateRenderSlot: rendererSlotMessages.duplicateDeclaration,
  renderSlotPlacementCount: rendererSlotMessages.renderSlotPlacementCount,
  duplicateRenderSlotFill: rendererSlotMessages.duplicateFill,
=======
  renderSlotDeclarationPlacement: 'A render slot must be declared directly in a view body.',
  duplicateRenderSlot: (name: string) => `Render slot '${name}' is declared more than once in this view.`,
  renderSlotPlacementCount: (name: string) =>
    `View render slot '${name}' must be placed exactly once in its render tree.`,
  renderSlotReferencePlacement: 'A bare render slot reference is only available in its owning view render tree.',
  renderSlotFillPlacement: 'A render slot fill must be a direct child of an invocation of its owning view.',
  duplicateRenderSlotFill: (name: string) => `Render slot '${name}' is filled more than once at this call site.`,
  renderSlotRendererContract: (name: string) =>
    `Renderer for slot '${name}' does not satisfy its callable input contract.`,
  renderSlotArguments: (name: string) => `Arguments of render slot '${name}' do not match its declared parameters.`,
  renderSlotInputCount: (name: string, available: number) =>
    `Inline renderer for slot '${name}' accepts at most ${available} input names.`,
  duplicateRenderSlotInput: (name: string) => `Inline renderer input '${name}' is declared more than once.`,
>>>>>>> ddd2cf876 (Resolve typed renderer slot bindings through actual occurrences)
  tagAttachment: 'A #tag must be followed immediately by a render or loop in the same block.',
  accessibilityAttachment: 'An accessible label cluster must be followed immediately by a render in the same block.',
  accessibilityText: 'An accessible label must be a text expression.',
  duplicateAccessibilityLabel: 'A render occurrence may have only one accessible label.',
  duplicatePrefixTag: 'A render occurrence may have only one #tag in its metadata cluster.',
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
    [AST.RenderAccessibilityStatement.$type]: validateRenderAccessibility,
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
  const target = AST.renderPrefixTarget(tag)
  if (!AST.isRender(target) && !AST.isForStatement(target)) {
    ctx.error(tag, viewValidationMessages.tagAttachment)
    return
  }
  if (AST.isForStatement(target) && !AST.loopRowRoot(target)) {
    ctx.error(target, viewValidationMessages.taggedLoopRoot)
  }
  const cluster = AST.renderPrefixCluster(target)
  if (cluster.filter(AST.isTagStatement).indexOf(tag) > 0) {
    ctx.error(tag, viewValidationMessages.duplicatePrefixTag)
  }
}

/** validateRenderAccessibility keeps occurrence metadata typed and attached to one concrete root. */
function validateRenderAccessibility(prefix: AST.RenderAccessibilityStatement, ctx: ValidationContext): void {
  const target = AST.renderPrefixTarget(prefix)
  if (!AST.isRender(target)) {
    ctx.error(prefix, viewValidationMessages.accessibilityAttachment)
  } else if (AST.renderPrefixCluster(target).filter(AST.isRenderAccessibilityStatement).indexOf(prefix) > 0) {
    ctx.error(prefix, viewValidationMessages.duplicateAccessibilityLabel)
  }
  const actual = Type.ofExpression(prefix.value)
  if (actual.kind !== 'unresolved' && !(actual.kind === 'primitive' && actual.primitive === 'text')) {
    ctx.error(prefix.value, viewValidationMessages.accessibilityText)
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
      || AST.isRenderAccessibilityStatement(statement)
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
    if (AST.isTagStatement(statement) || AST.isRenderAccessibilityStatement(statement)) {
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
      if (AST.isRenderSlotFill(statement)) {
        if (statement.render) {
          validateRender(statement.render, block, ctx)
        }
        if (statement.block) {
          validateRenderBlock(statement.block, ctx)
        }
        continue
      }
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
      if (statement.otherwise) {
        validateRenderBlock(statement.otherwise.block, ctx)
      }
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
      if (AST.isBlock(statement.block)) {
        validateRenderBlock(statement.block, ctx)
      }
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
  if (
    AST.isRenderStatement(render) && render.view === undefined
    && render.expression === undefined && render.injection === undefined
  ) {
    ctx.error(render, viewValidationMessages.renderTarget)
  }
  // The one fact a scene carries that a body cannot state. Diagnosing it here, at the render site,
  // is what makes chrome nothing reads unrepresentable: a declaration that fills `Title` can never
  // end up composed inline where no host would read it. A nav is a scene by the Prelude and is the
  // one exception: it supplies its own chrome, so a render site may name it.
  const target = render.view?.ref
  if (render.expression !== undefined && ASTUtils.resolveRenderTarget(render) === undefined) {
    const type = Type.ofExpression(render.expression)
    if (type.kind !== 'unresolved') {
      ctx.error(
        render,
        viewValidationMessages.bareRenderTargetType(
          render.expression.$cstNode?.text ?? 'expression',
          Type.displayName(type),
        ),
      )
    }
  }
  if (
    (AST.isAliasDeclaration(target) || AST.isStateDeclaration(target) || AST.isParameterDeclaration(target))
    && ASTUtils.resolveRenderTarget(render) === undefined
  ) {
    const type = Type.ofValueDeclaration(target, render)
    if (type.kind !== 'unresolved') {
      ctx.error(
        render,
        viewValidationMessages.bareRenderTargetType(Type.declarationName(target), Type.displayName(type)),
      )
    }
  }
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
          && !(AST.isRenderSlotUse(statement) && AST.isRenderSlotFill(statement))
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
    ctx.error(declaration, rendererSlotMessages.declarationPlacement)
  }
  const renderer = declaration.renderer?.ref
  if (renderer && !ASTUtils.compareRendererSlotRenderer(declaration, renderer).compatible) {
    ctx.error(declaration, viewValidationMessages.renderSlotRendererContract(declaration.name))
  }
}

function validateRenderSlots(view: AST.ViewDeclaration, ctx: ValidationContext): void {
  // Alias views share the target's exact declarations; validate declaration-owned rules once.
  if (view.aliasTarget) {
    return
  }
  const declarations = AST.renderSlotDeclarationsOf(view)
  const seen = new Set<string>()
  for (const declaration of declarations) {
    if (seen.has(declaration.name)) {
      ctx.error(declaration, rendererSlotMessages.duplicateDeclaration(declaration.name))
    }
    seen.add(declaration.name)
  }
}

function validateRenderSlotUse(use: AST.RenderSlotUse, ctx: ValidationContext): void {
  if (!AST.isRenderSlotFill(use)) {
    const owner = AST.findOwningView(use)
    const declaration = use.slot.ref
    if (
      !AST.isViewDeclaration(owner)
      || !declaration
      || !AST.renderSlotDeclarationsOf(owner).includes(declaration)
    ) {
      ctx.error(use, rendererSlotMessages.referencePlacement)
    }
    for (const diagnostic of ASTUtils.bindRendererSlotArguments(use)?.diagnostics ?? []) {
      ctx.error(
        'argument' in diagnostic ? diagnostic.argument : use,
        viewValidationMessages.renderSlotArguments(use.slot.$refText),
      )
    }
    return
  }

  const block = use.$container
  const invocation = AST.isBlock(block) && AST.isRender(block.$container) ? block.$container : undefined
  const target = invocation?.view?.ref
  const declaration = use.slot.ref
  const validOwner = AST.isViewDeclaration(target)
    && declaration !== undefined
    && AST.renderSlotDeclarationsOf(target).includes(declaration)
  if (!validOwner) {
    ctx.error(use, rendererSlotMessages.fillPlacement)
  }
  if (declaration) {
    const renderer = use.renderer?.ref
    const comparison = renderer
      ? ASTUtils.compareRendererSlotRenderer(declaration, renderer, use)
      : ASTUtils.compareRendererSlotForwarding(use)
    if (comparison && !comparison.compatible) {
      ctx.error(use, viewValidationMessages.renderSlotRendererContract(declaration.name))
    }
    const availableInputs = AST.renderSlotParametersOf(declaration).length
    if (use.inputBindings.length > availableInputs) {
      ctx.error(use, viewValidationMessages.renderSlotInputCount(declaration.name, availableInputs))
    }
  }
  const seenInputs = new Set<string>()
  for (const input of use.inputBindings) {
    if (seenInputs.has(input.name)) {
      ctx.error(input, viewValidationMessages.duplicateRenderSlotInput(input.name))
    }
    seenInputs.add(input.name)
  }
  if (AST.isBlock(block)) {
    const fills = AST.renderSlotUsesOf(block)
      .filter(candidate => AST.isRenderSlotFill(candidate) && candidate.slot.$refText === use.slot.$refText)
    if (fills.indexOf(use) > 0) {
      ctx.error(use, rendererSlotMessages.duplicateFill(use.slot.$refText))
    }
  }
}
