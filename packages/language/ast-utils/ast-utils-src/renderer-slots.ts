import { AST } from '@parser'
import type { ArgumentBindingResult } from './argument-bindings'
import {
  bindCallableArguments,
  type CallableSignature,
  callableSignatureOf,
  compareCallableSignatures,
} from './callable-signatures'

/** rendererSlotSignatureOf builds the callable contract from a slot's real owned parameters. */
export function rendererSlotSignatureOf(contract: AST.RenderSlotContract): CallableSignature {
  return callableSignatureOf(AST.renderSlotParametersOf(contract))
}

/** bindRendererSlotArguments binds only a linked placement; fills and unresolved uses have no signature. */
export function bindRendererSlotArguments(use: AST.RenderSlotUse): ArgumentBindingResult | undefined {
  if (AST.isRenderSlotFill(use)) {
    return undefined
  }
  const contract = use.slot.ref
  return contract
    ? bindCallableArguments(rendererSlotSignatureOf(contract), AST.argumentsOf(use))
    : undefined
}

/** compareRendererSlotRenderer admits a named implementation against its receiving slot contract. */
export function compareRendererSlotRenderer(
  contract: AST.RenderSlotContract,
  view: AST.ViewDeclaration,
): ReturnType<typeof compareCallableSignatures> {
  return compareCallableSignatures(callableSignatureOf(view), rendererSlotSignatureOf(contract))
}

/** rendererSlotDefaultParameterCorrespondence maps default-view inputs to slot inputs by contract. */
export function rendererSlotDefaultParameterCorrespondence(
  contract: AST.RenderSlotContract,
  view: AST.ViewDeclaration,
): ReturnType<typeof compareCallableSignatures>['correspondence'] {
  const target = callableSignatureOf(view)
  const required = rendererSlotSignatureOf(contract)
  const storageNeutral = (signature: CallableSignature): CallableSignature => ({
    ...signature,
    inputs: signature.inputs.map(input => ({ ...input, callerWritable: false })),
  })
  return compareCallableSignatures(storageNeutral(target), storageNeutral(required)).correspondence
}
