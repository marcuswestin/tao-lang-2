import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { AssociatedMethodsValidationMessages as messages } from './AssociatedMethodsValidationMessages'
import { FunctionsValidator } from './functions-validator'
import { ReactiveParametersValidator } from './ReactiveParametersValidator'

export const associatedMethodsValidationChecks = {
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
    const type = Type.ofDefinition(owner)
    if (type.kind !== 'primitive' || type.primitive !== 'text') {
      ctx.error(method, messages.family)
    }
    const descriptor = ASTUtils.associatedCallableDescriptor(method)
    if (descriptor) {
      const analysis = ASTUtils.associatedCallableAnalysis(method)
      if (!analysis || analysis.effects.purity.open || analysis.effects.purity.violations.length > 0) {
        ctx.error(method, messages.purity(method.name))
      }
      if (
        analysis && !ASTUtils.failureContractSatisfiesBound(analysis.effects.failures, descriptor.signature.failures)
      ) {
        ctx.error(method, messages.failures(method.name))
      }
    }
  },
  [AST.CapabilityTypeExpression.$type]: (capability, ctx) => {
    const names = new Set<string>()
    for (const method of capability.methods) {
      if (names.has(method.name)) {
        ctx.error(method, messages.duplicateRequirement(method.name))
      }
      names.add(method.name)
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

function validateFailureBound(
  method: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
  ctx: ValidationContext,
): void {
  if (method.failureBound !== undefined && method.failureBound !== 'never') {
    ctx.error(method, messages.failureBound)
  }
}
