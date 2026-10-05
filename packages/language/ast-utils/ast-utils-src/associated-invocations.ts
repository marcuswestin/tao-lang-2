import { AST } from '@parser'
import { Assert } from '@shared'
import {
  type ArgumentBindingDiagnostic,
  type ArgumentBindingMetadata,
  type RenderInvocationPair,
  resolveParameterArgumentBindings,
} from './argument-bindings'
import {
  type AssociatedCallableDescriptor,
  type AssociatedDescriptorMaterialization,
  associatedMethodCallTarget,
  type AssociatedMethodReceiver,
} from './associated-methods'
import { substituteGenericType } from './generic-bindings'
import { type TaoType, Type } from './Type'

/** Associated calls retain their real receiver, selected owner and shared argument-binding witnesses. */
export type ResolvedAssociatedMethodInvocation = {
  invocation: AST.MethodCallExpression
  receiver?: TaoType
  declaration?: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration
  descriptor?: AssociatedCallableDescriptor
  pairs: RenderInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
  parameterTypes?: ReadonlyMap<AST.ParameterDeclaration, TaoType>
  transportTypes?: ReadonlyMap<AST.ParameterDeclaration, TaoType>
  genericDiagnostics?: ReturnType<typeof Type.instantiateGenericInvocation>['genericDiagnostics']
  problem?: 'unresolved-receiver' | 'unknown-method' | 'pending-contract' | 'unsupported-callee'
}

/** Resolve a real postfix call without fabricating a receiver expression or rebinding its root. */
export function resolveAssociatedMethodInvocation(
  invocation: AST.MethodCallExpression,
  options: {
    receiverType?(receiver: AssociatedMethodReceiver): TaoType
    descriptor?(
      declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
    ): AssociatedDescriptorMaterialization | undefined
    methodDeclaration?(
      receiver: TaoType,
      name: string,
    ): Readonly<{ declaration: AST.AssociatedFunctionDeclaration; owner: AST.TypeDeclaration }> | undefined
    bindingMetadata?: ArgumentBindingMetadata
  } = {},
): ResolvedAssociatedMethodInvocation {
  const target = associatedMethodCallTarget(invocation)
  if (!target) {
    return { invocation, pairs: [], diagnostics: [], problem: 'unsupported-callee' }
  }
  const receiver = options.receiverType
    ? options.receiverType(target.receiver)
    : target.receiver.kind === 'expression'
    ? Type.ofExpression(target.receiver.expression)
    : Type.atMemberPath(Type.ofReferenceRoot(target.receiver.site), target.receiver.members)
  if (receiver.kind === 'unresolved') {
    return { invocation, receiver, pairs: [], diagnostics: [], problem: 'unresolved-receiver' }
  }

  let descriptor: AssociatedCallableDescriptor | undefined
  if (options.descriptor) {
    const declaration = receiver.kind === 'capability' || receiver.genericParameter
      ? Type.aggregateCapabilityRequirements(receiver).find(requirement => requirement.name === target.name)
      : (options.methodDeclaration ?? Type.associatedMethodDeclaration)(receiver, target.name)?.declaration
    if (!declaration) {
      return { invocation, receiver, pairs: [], diagnostics: [], problem: 'unknown-method' }
    }
    const contract = options.descriptor(declaration)
    if (!contract || contract.kind === 'pending') {
      return { invocation, receiver, declaration, pairs: [], diagnostics: [], problem: 'pending-contract' }
    }
    descriptor = contract.descriptor
  } else if (receiver.kind === 'capability' || receiver.genericParameter) {
    const requirements = Type.aggregateCapabilityRequirements(receiver)
    const index = requirements.findIndex(requirement => requirement.name === target.name)
    if (index === -1) {
      return { invocation, receiver, pairs: [], diagnostics: [], problem: 'unknown-method' }
    }
    const contract = Type.capabilityMethods(receiver)[index]
    Assert.defined(contract, 'a materialized contract for every capability requirement')
    if (contract.kind === 'pending') {
      return {
        invocation,
        receiver,
        declaration: requirements[index],
        pairs: [],
        diagnostics: [],
        problem: 'pending-contract',
      }
    }
    descriptor = contract.descriptor
  } else {
    descriptor = Type.associatedMethods(receiver).find(selection =>
      selection.descriptor.declaration.name === target.name
    )
      ?.descriptor
    if (!descriptor) {
      const declaration = Type.associatedMethodDeclaration(receiver, target.name)
      return {
        invocation,
        receiver,
        ...(declaration ? { declaration: declaration.declaration } : {}),
        pairs: [],
        diagnostics: [],
        problem: declaration ? 'pending-contract' : 'unknown-method',
      }
    }
  }

  descriptor = Type.specializeAssociatedDescriptor(descriptor, receiver)
  const inputs = new Map(descriptor.signature.inputs.map(input => [input.declaration, input]))
  const inputOf = (parameter: AST.ParameterDeclaration) => {
    const input = inputs.get(parameter)
    Assert.defined(input, 'a signature input for every associated method parameter')
    return input
  }
  const generic =
    AST.isAssociatedFunctionDeclaration(descriptor.declaration) && descriptor.declaration.genericParameters.length > 0
      ? Type.instantiateGenericInvocation(descriptor.declaration, AST.argumentsOf(invocation), {
        ...options.bindingMetadata,
        parameterType: parameter => inputOf(parameter).type,
      })
      : undefined
  if (generic) {
    descriptor = {
      ...descriptor,
      signature: {
        ...descriptor.signature,
        inputs: descriptor.signature.inputs.map(input => ({
          ...input,
          type: generic.parameterTypes.get(input.declaration) ?? input.type,
        })),
      },
      result: substituteGenericType(generic.result, generic.bindings, receiver),
    }
  }
  const bindings = generic ?? resolveParameterArgumentBindings(
    descriptor.declaration.parameterList.parameters,
    AST.argumentsOf(invocation),
    {
      ...options.bindingMetadata,
      parameterType: parameter => generic?.parameterTypes.get(parameter) ?? inputOf(parameter).type,
      parameterName: options.bindingMetadata?.parameterName ?? Type.parameterName,
      parameterOmissible: parameter => inputOf(parameter).omissible,
      argumentType: options.bindingMetadata?.argumentType ?? Type.ofArgument,
      accepts: options.bindingMetadata?.accepts ?? Type.isAssignable,
    },
  )
  return {
    invocation,
    receiver,
    declaration: descriptor.declaration,
    descriptor,
    pairs: bindings.pairs,
    diagnostics: bindings.diagnostics,
    ...(generic
      ? {
        parameterTypes: generic.parameterTypes,
        transportTypes: generic.transportTypes,
        genericDiagnostics: generic.genericDiagnostics,
        ...(generic.genericDiagnostics.length > 0 ? { problem: 'pending-contract' as const } : {}),
      }
      : {}),
  }
}
