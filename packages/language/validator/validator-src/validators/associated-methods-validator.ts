import { Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { AssociatedMethodsValidationMessages as messages } from './AssociatedMethodsValidationMessages'

export const associatedMethodsValidationChecks = {
  [AST.AssociatedFunctionDeclaration.$type]: (method, ctx) => {
    validateFailureBound(method, ctx)
    const owner = AST.associatedFunctionOwner(method)
    if (!owner) {
      ctx.error(method, messages.owner)
      return
    }
    const type = Type.ofDefinition(owner)
    if (type.kind !== 'primitive' || type.primitive !== 'text') {
      ctx.error(method, messages.family)
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
} satisfies NodeValidationChecks

function validateFailureBound(
  method: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
  ctx: ValidationContext,
): void {
  if (method.failureBound !== undefined && method.failureBound !== 'never') {
    ctx.error(method, messages.failureBound)
  }
}
