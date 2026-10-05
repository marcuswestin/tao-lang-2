import { ASTUtils, declaredCallableFailureContract, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { AssociatedMethodsValidationMessages as messages } from './AssociatedMethodsValidationMessages'
import { FunctionsValidator } from './functions-validator'
import { ReactiveParametersValidator } from './ReactiveParametersValidator'

export const associatedMethodsValidationChecks = {
  [AST.TypeDeclaration.$type]: validateAssociatedOwner,
  [AST.PrimitiveDeclaration.$type]: validateAssociatedOwner,
  [AST.EntityDataDeclaration.$type]: validateAssociatedOwner,
  [AST.AssociatedFunctionDeclaration.$type]: (method, ctx) => {
    validateFailureBound(method, ctx)
    const owner = AST.associatedFunctionOwner(method)
    if (!owner) {
      ctx.error(method, messages.owner)
      return
    }
    if (!AST.isTaoFile(owner.$container)) {
      ctx.error(owner, messages.placement)
    }
    if (AST.isEntityDataDeclaration(owner)) {
      if (method.receiverName === undefined) {
        ctx.error(method, messages.entityReceiverRequired(owner.singularName))
      } else {
        if (AST.associatedEntityReceiverOwner(method) !== owner) {
          ctx.error(method, messages.receiverOwner(method.receiverName, owner.singularName))
        } else {
          validateEntityReceiverShadow(method, ctx)
        }
      }
    } else if (method.receiverName !== undefined && method.receiverName !== owner.name) {
      ctx.error(method, messages.receiverOwner(method.receiverName, owner.name))
    }
    const type = Type.ofAssociatedOwner(owner)
    if (
      type.kind !== 'entity' && type.kind !== 'item'
      && (type.kind !== 'primitive' || !['text', 'number', 'numeric'].includes(type.primitive))
    ) {
      ctx.error(method, messages.family)
    }
    const descriptor = ASTUtils.associatedCallableDescriptor(method)
    if (descriptor) {
      const analysis = ASTUtils.associatedCallableAnalysis(method)
      if (!analysis || analysis.effects.purity.open || analysis.effects.purity.violations.length > 0) {
        ctx.error(method, messages.purity(method.name))
      }
      if (
        analysis
        && !ASTUtils.failureContractSatisfiesBound(analysis.effects.failures, declaredCallableFailureContract(method))
      ) {
        ctx.error(method, messages.failures(method.name))
      }
    }
  },
  [AST.AssociatedConverterDeclaration.$type]: (converter, ctx) => {
    const descriptor = Type.associatedConverterDescriptor(converter)
    if (!descriptor) {
      ctx.error(converter, messages.converterOwner)
      return
    }
    const { owner, receiver, result, signature } = descriptor
    const ownerType = Type.ofDefinition(owner)
    if (
      Type.identityKey(ownerType) !== Type.identityKey(receiver)
      && Type.identityKey(ownerType) !== Type.identityKey(result)
    ) {
      ctx.error(converter, messages.converterAttachment)
    }
    if (converter.failureBounds.includes('never') && converter.failureBounds.length > 1) {
      ctx.error(converter, messages.converterNever)
    }
    if (!AST.functionHasFallthroughReturn(converter)) {
      ctx.error(converter.block, messages.converterReturn)
    }
    for (const statement of AST.returnStatementsOf(converter)) {
      const actual = Type.ofExpression(statement.value)
      if (actual.kind !== 'unresolved' && result.kind !== 'unresolved' && !Type.isAssignable(actual, result)) {
        ctx.error(statement.value, messages.converterResult(Type.displayName(result), Type.displayName(actual)))
      }
    }
    const analysis = ASTUtils.associatedCallableAnalysis(converter)
    if (!analysis || analysis.effects.purity.open || analysis.effects.purity.violations.length > 0) {
      ctx.error(converter, messages.converterPurity)
    }
    if (analysis && !ASTUtils.failureContractSatisfiesBound(analysis.effects.failures, signature.failures)) {
      ctx.error(converter, messages.converterFailures)
    }
  },
  [AST.ConversionExpression.$type]: (conversion, ctx) => {
    const resolved = Type.associatedConversion(conversion)
    if (resolved.problem && resolved.problem !== 'unresolved-contract') {
      ctx.error(
        conversion,
        resolved.problem === 'ambiguous-converter'
          ? messages.converterAmbiguous(Type.displayName(resolved.source), Type.displayName(resolved.target))
          : messages.converterMissing(Type.displayName(resolved.source), Type.displayName(resolved.target)),
      )
    }
  },
  [AST.CapabilityTypeExpression.$type]: (capability, ctx) => {
    const previous: AST.CapabilityMethodDeclaration[] = []
    for (const method of capability.methods) {
      const owner = capabilityRequirementOwner(method)
      const contract = owner && Type.associatedCallable(method, owner)
      if (
        previous.some(other => {
          if (other.name !== method.name) {
            return false
          }
          if (!operatorNames.has(method.name)) {
            return true
          }
          const preceding = owner && Type.associatedCallable(other, owner)
          return contract?.kind === 'ready' && preceding?.kind === 'ready'
            && Type.sameAssociatedCallableContract(contract.descriptor, preceding.descriptor)
        })
      ) {
        ctx.error(method, messages.duplicateRequirement(method.name))
      }
      previous.push(method)
    }
  },
  [AST.CapabilityMethodDeclaration.$type]: (method, ctx) => {
    validateFailureBound(method, ctx)
    const names = new Set<string>()
    for (const parameter of AST.parametersOf(method)) {
      const name = Type.parameterName(parameter)
      if (names.has(name)) {
        ctx.error(parameter, messages.duplicateParameter(name))
      }
      names.add(name)
    }
  },
  [AST.FunctionDeclaration.$type]: validateFailureBound,
  [AST.MethodCallExpression.$type]: (call, ctx) => {
    if (ASTUtils.resolveNumericUnitReading(call).kind !== 'not-unit-reading') {
      return
    }
    const resolved = ASTUtils.resolveAssociatedMethodInvocation(call)
    if (resolved.problem) {
      if (resolved.problem !== 'unresolved-receiver') {
        const name = ASTUtils.associatedMethodCallTarget(call)?.name ?? 'method'
        ctx.error(call, resolved.problem === 'pending-contract' ? messages.pending(name) : messages.unknown(name))
      }
      return
    }
    if (!resolved.descriptor) {
      return
    }
    const name = `${resolved.descriptor.owner.name}.${resolved.descriptor.declaration.name}`
    const inputs = new Map(resolved.descriptor.signature.inputs.map(input => [input.declaration, input]))
    FunctionsValidator.reportBindingDiagnostics(
      call,
      name,
      resolved.diagnostics,
      ctx,
      parameter => inputs.get(parameter)!.type,
    )
    for (const pair of resolved.pairs) {
      if (inputs.get(pair.parameter)!.callerWritable && !ASTUtils.writableExpression(pair.argument.value)) {
        ctx.error(
          pair.argument,
          ReactiveParametersValidator.messages.readonlyArgument(Type.parameterName(pair.parameter)),
        )
      }
    }
  },
  [AST.ParameterDeclaration.$type]: (parameter, ctx) => {
    if (!parameter.mutable) {
      return
    }
    const owner = parameter.$container?.$container
    if (
      AST.isViewDeclaration(owner)
      && (owner.foreign || AST.streamAllContents(owner).some(AST.isInjection))
      && containsCapability(Type.ofParameter(parameter))
    ) {
      ctx.error(parameter, messages.nativeMutable)
    }
  },
} satisfies NodeValidationChecks

function containsCapability(type: ASTUtils.TaoType): boolean {
  return type.kind === 'capability'
    || (type.kind === 'union' && type.members.some(containsCapability))
    || (type.kind === 'list' && type.element !== undefined && containsCapability(type.element))
}

const operatorNames = new Set(['+', '-', '*', '/', '==', '!=', '<', '<=', '>', '>='])

function validateAssociatedOwner(
  owner: NonNullable<ReturnType<typeof AST.associatedFunctionOwner>>,
  ctx: ValidationContext,
): void {
  const ordinaryNames = new Set<string>()
  const operatorContracts: ASTUtils.AssociatedCallableDescriptor[] = []
  for (const method of ASTUtils.ownAssociatedMethods(owner)) {
    if (!operatorNames.has(method.name)) {
      if (ordinaryNames.has(method.name)) {
        ctx.error(method, messages.duplicateImplementation(owner.name, method.name))
      }
      ordinaryNames.add(method.name)
      continue
    }
    const contract = Type.associatedCallable(method, owner)
    if (contract.kind === 'ready') {
      if (operatorContracts.some(previous => Type.sameAssociatedCallableContract(previous, contract.descriptor))) {
        ctx.error(method, messages.duplicateImplementation(owner.name, method.name))
      }
      operatorContracts.push(contract.descriptor)
    }
  }
}

function validateEntityReceiverShadow(method: AST.AssociatedFunctionDeclaration, ctx: ValidationContext): void {
  const alias = method.receiverName
  if (alias === undefined) {
    return
  }
  const shadowsParameter = AST.parametersOf(method).some(parameter => Type.parameterName(parameter) === alias)
  if (shadowsParameter) {
    ctx.error(method, messages.entityReceiverShadow(alias))
  }
}

function validateFailureBound(
  method: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
  ctx: ValidationContext,
): void {
  const bounds = method.failureBound === undefined ? [] : [method.failureBound, ...method.additionalFailureBounds]
  if (bounds.includes('never') && bounds.length > 1) {
    ctx.error(method, messages.failureBound)
  }
}

function capabilityRequirementOwner(method: AST.CapabilityMethodDeclaration): AST.TypeDeclaration | undefined {
  let node: AST.Node | undefined = method.$container
  while (node) {
    if (AST.isTypeDeclaration(node)) {
      return node
    }
    node = node.$container
  }
  return undefined
}
