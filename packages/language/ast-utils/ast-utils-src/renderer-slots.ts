import { AST } from '@parser'
import type { ArgumentBindingMetadata, ArgumentBindingResult } from './argument-bindings'
import {
  bindCallableArguments,
  type CallableInput,
  type CallableSignature,
  callableSignatureOf,
  compareCallableSignatures,
} from './callable-signatures'
import { substituteGenericType } from './generic-bindings'
import { resolveRenderInvocation } from './invocations'
import { Type } from './Type'

/** rendererSlotSignatureOf builds the callable contract from a slot's real owned parameters. */
export function rendererSlotSignatureOf(
  contract: AST.RenderSlotContract,
  occurrence?: AST.RenderSlotUse,
  metadata?: ArgumentBindingMetadata,
): CallableSignature {
  const signature = callableSignatureOf(AST.renderSlotParametersOf(contract))
  const invocation = occurrence && occurrence.slot.ref === contract ? AST.renderSlotInvocationOf(occurrence) : undefined
  if (!invocation) {
    return signature
  }
  const bindings = resolveRenderInvocation(invocation, metadata).bindings ?? new Map()
  return {
    ...signature,
    inputs: signature.inputs.map(input => {
      const type = substituteGenericType(input.type, bindings)
      return { ...input, type, acceptsNone: Type.isAssignable(Type.ofNone(), type) }
    }),
  }
}

/** RendererSlotInputDomain retains the real lexical binding and receiving callable input. */
export type RendererSlotInputDomain = Readonly<{
  binding: AST.RenderSlotInputBinding
  parameter: AST.ParameterDeclaration
  input: CallableInput
}>

/** resolveRendererSlotInputBinding gives an inline name its positional receiving input domain. */
export function resolveRendererSlotInputBinding(
  binding: AST.RenderSlotInputBinding,
  metadata?: ArgumentBindingMetadata,
): RendererSlotInputDomain | undefined {
  const use = binding.$container
  if (!AST.isRenderSlotUse(use) || !AST.isRenderSlotFill(use) || !use.render) {
    return undefined
  }
  const contract = use.slot.ref
  const index = use.inputBindings.indexOf(binding)
  const input = contract && index >= 0 ? rendererSlotSignatureOf(contract, use, metadata).inputs[index] : undefined
  return input ? { binding, parameter: input.declaration, input } : undefined
}

/** compareRendererSlotForwarding checks a lexical renderer against its specialized receiving slot. */
export function compareRendererSlotForwarding(
  use: AST.RenderSlotUse,
  metadata?: ArgumentBindingMetadata,
): ReturnType<typeof compareCallableSignatures> | undefined {
  const required = use.slot.ref
  const supplied = use.forwardedSlot?.ref
  return AST.isRenderSlotFill(use) && required && supplied
    ? compareRendererSignatures(rendererSlotSignatureOf(supplied), rendererSlotSignatureOf(required, use, metadata))
    : undefined
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
  occurrence?: AST.RenderSlotUse,
  metadata?: ArgumentBindingMetadata,
): ReturnType<typeof compareCallableSignatures> {
  return compareRendererSignatures(callableSignatureOf(view), rendererSlotSignatureOf(contract, occurrence, metadata))
}

/** A specialized generic role can correspond by its unique concrete domain when no role matches. */
function compareRendererSignatures(
  supplied: CallableSignature,
  required: CallableSignature,
): ReturnType<typeof compareCallableSignatures> {
  const inputs = required.inputs.map(input => {
    const generic = Type.ofParameter(input.declaration).genericParameter
    const specialized = generic && input.type.genericParameter !== generic
    const roleExists = supplied.inputs.some(target => (target.role ?? target.labelName) === input.role)
    return input.role && specialized && !roleExists ? { ...input, role: undefined } : input
  })
  const comparison = compareCallableSignatures(supplied, { ...required, inputs })
  const originals = new Map(required.inputs.map(input => [input.declaration, input]))
  return {
    ...comparison,
    correspondence: comparison.correspondence.map(pair => ({
      ...pair,
      required: originals.get(pair.required.declaration)!,
    })),
  }
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
