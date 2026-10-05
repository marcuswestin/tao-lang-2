import { ASTUtils, Type } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { RendererSlotsValidationMessages as messages } from './RendererSlotsValidationMessages'

/** rendererSlotsValidationChecks validates slot invocation arguments and renderer compatibility. */
export const rendererSlotsValidationChecks = {
  [AST.RenderSlotDeclaration.$type]: validateRenderSlotDeclaration,
  [AST.ForeignViewSlotDeclaration.$type]: validateDuplicateSlotParameters,
  [AST.RenderSlotUse.$type]: validateRenderSlotUse,
} satisfies NodeValidationChecks

function validateRenderSlotDeclaration(declaration: AST.RenderSlotDeclaration, ctx: ValidationContext): void {
  validateDuplicateSlotParameters(declaration, ctx)
  const body = AST.renderSlotBodyOf(declaration)
  if (body.kind === 'absent' && hasRenderSlotBodyIntroducer(declaration)) {
    ctx.error(declaration, messages.absentBody(declaration.name))
    return
  }
  validateRendererBody(body, declaration, declaration.name, declaration, ctx)
}

function validateRenderSlotUse(use: AST.RenderSlotUse, ctx: ValidationContext): void {
  const contract = use.slot.ref
  if (!contract) {
    return
  }
  if (!AST.isRenderSlotFill(use)) {
    validatePlacement(use, ctx)
    return
  }

  const body = AST.renderSlotBodyOf(use)
  if (body.kind === 'absent') {
    ctx.error(use, messages.absentBody(use.slot.$refText))
    return
  }
  validateRendererBody(body, contract, use.slot.$refText, use, ctx)
}

function validateDuplicateSlotParameters(
  declaration: AST.RenderSlotContract,
  ctx: ValidationContext,
): void {
  const seen = new Set<string>()
  for (const parameter of AST.renderSlotParametersOf(declaration)) {
    const name = Type.parameterName(parameter)
    if (seen.has(name)) {
      ctx.error(parameter, messages.duplicateParameter(name))
    }
    seen.add(name)
  }
}

function hasRenderSlotBodyIntroducer(declaration: AST.RenderSlotDeclaration): boolean {
  const cst = declaration.$cstNode
  if (!cst) {
    return false
  }
  let parameterDepth = 0
  for (const token of Langium.CstUtils.streamCst(cst)) {
    if (!Langium.isLeafCstNode(token) || token.hidden) {
      continue
    }
    if (token.text === '(') {
      parameterDepth += 1
    } else if (token.text === ')') {
      parameterDepth -= 1
    } else if (token.text === ':' && parameterDepth === 0) {
      return true
    }
  }
  return false
}

function validatePlacement(use: AST.RenderSlotUse, ctx: ValidationContext): void {
  const binding = ASTUtils.bindRendererSlotArguments(use)
  if (!binding) {
    return
  }
  for (const diagnostic of binding.diagnostics) {
    Switch.on(diagnostic, 'kind', {
      'duplicate-parameter-type': item => ctx.error(item.parameter, messages.argumentDuplicateParameterType(item.type)),
      'duplicate-argument-type': item => ctx.error(item.argument, messages.argumentDuplicateType(item.type)),
      'unknown-named-argument': item => ctx.error(item.argument, messages.argumentUnknownName(item.name)),
      'duplicate-named-argument': item =>
        ctx.error(item.argument, messages.argumentDuplicateName(Type.parameterName(item.parameter))),
      'named-argument-type': item =>
        ctx.error(item.argument, messages.argumentNamedType(Type.parameterName(item.parameter))),
      'ambiguous-argument': item => ctx.error(item.argument, messages.argumentAmbiguous),
      'ambiguous-parameter': item => ctx.error(item.parameter, messages.argumentAmbiguous),
      'unmatched-argument': item => ctx.error(item.argument, messages.argumentUnmatched),
      'missing-argument': item =>
        ctx.error(item.parameter, messages.argumentMissing(Type.parameterName(item.parameter))),
    })
  }
}

function validateRendererBody(
  body: AST.RenderSlotBody,
  contract: AST.RenderSlotContract,
  name: string,
  anchor: AST.Node,
  ctx: ValidationContext,
): void {
  if (body.kind === 'empty' || body.kind === 'absent') {
    return
  }
  if (body.kind === 'named') {
    const renderer = body.renderer.ref
    if (AST.isViewDeclaration(renderer)) {
      validateNamedRenderer(contract, renderer, anchor, ctx)
    }
    return
  }
  if (body.kind === 'forwarded') {
    if (AST.isRenderSlotUse(anchor)) {
      const comparison = ASTUtils.compareRendererSlotForwarding(anchor)
      if (comparison) {
        validateRendererComparison(comparison, anchor, ctx)
      }
    }
    return
  }
  const inlineAnchor = body.kind === 'render' ? body.render : body.block
  const use = AST.isRenderSlotUse(anchor) ? anchor : undefined
  const count = ASTUtils.rendererSlotSignatureOf(contract, use).inputs.length
  if (count > 0 && !use?.inputBindings.length) {
    ctx.error(inlineAnchor, messages.inlineInputs(name))
  }
  if (use) {
    if (use.inputBindings.length > count) {
      ctx.error(use, messages.inlineInputCount(name, count))
    }
    const seen = new Set<string>()
    for (const binding of use.inputBindings) {
      if (seen.has(binding.name)) {
        ctx.error(binding, messages.duplicateInlineInput(binding.name))
      }
      seen.add(binding.name)
    }
  }
}

function validateNamedRenderer(
  contract: AST.RenderSlotContract,
  renderer: AST.ViewDeclaration,
  reference: AST.Node,
  ctx: ValidationContext,
): void {
  const comparison = ASTUtils.compareRendererSlotRenderer(
    contract,
    renderer,
    AST.isRenderSlotUse(reference) ? reference : undefined,
  )
  validateRendererComparison(comparison, reference, ctx)
}

function validateRendererComparison(
  comparison: ReturnType<typeof ASTUtils.compareRendererSlotRenderer>,
  reference: AST.Node,
  ctx: ValidationContext,
): void {
  for (const diagnostic of comparison.diagnostics) {
    Switch.on(diagnostic, 'kind', {
      'duplicate-target-type': item =>
        ctx.error(
          item.target.declaration,
          messages.rendererDuplicateInput(Type.parameterName(item.target.declaration)),
        ),
      'duplicate-candidate-type': item =>
        ctx.error(
          item.candidate.declaration,
          messages.rendererDuplicateInput(Type.parameterName(item.candidate.declaration)),
        ),
      'unknown-named': item => ctx.error(item.candidate.declaration, messages.rendererUnknownRole(item.name)),
      'duplicate-named': item =>
        ctx.error(
          item.candidate.declaration,
          messages.rendererDuplicateRole(Type.parameterName(item.candidate.declaration)),
        ),
      'named-type': item =>
        ctx.error(item.target.declaration, messages.rendererRoleType(Type.parameterName(item.target.declaration))),
      'ambiguous-candidate': item => ctx.error(item.candidate.declaration, messages.rendererAmbiguous),
      'ambiguous-target': item => ctx.error(item.target.declaration, messages.rendererAmbiguous),
      unmatched: item =>
        ctx.error(item.candidate.declaration, messages.rendererMissing(Type.parameterName(item.candidate.declaration))),
      missing: item =>
        ctx.error(item.target.declaration, messages.rendererRequiresInput(Type.parameterName(item.target.declaration))),
      'incompatible-input': item => {
        const name = Type.parameterName(item.supplied.declaration)
        for (const reason of item.reasons) {
          Switch(reason, {
            'input-domain': () => ctx.error(item.supplied.declaration, messages.rendererInputDomain(name)),
            omission: () => ctx.error(item.supplied.declaration, messages.rendererOmission(name)),
            'caller-storage': () => ctx.error(item.supplied.declaration, messages.rendererStorage(name)),
            'write-domain': () => ctx.error(item.supplied.declaration, messages.rendererWriteDomain(name)),
          })
        }
      },
      'failure-bound': () => ctx.error(reference, messages.rendererFailureBound),
      'unresolved-input': () => undefined,
    })
  }
}
