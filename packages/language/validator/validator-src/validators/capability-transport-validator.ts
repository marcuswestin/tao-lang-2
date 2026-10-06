import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** Source transport limits are distinct from semantic type admission. */
export const CapabilityTransportValidationMessages = {
  alternatives: (expected: string) =>
    `Cannot convert this union to '${expected}' because its alternatives require different capability methods.`,
  list: (expected: string) => `Converting list elements to '${expected}' is not supported.`,
  action: (expected: string) => `Converting action inputs to '${expected}' is not supported.`,
  writable: (expected: string) => `Converting writable method inputs to '${expected}' is not supported.`,
} as const

/** Registration and the sealed effect context are installed by the validation owner. */
export const capabilityTransportValidationChecks = {
  [AST.ReturnStatement.$type]: (statement, ctx) => {
    const owner = AST.findOwningAssociatedFunction(statement) ?? AST.findOwningFunction(statement)
    if (owner) {
      validateCapabilityTransport(statement.value, Type.ofFunctionReturn(owner), ctx)
    }
  },
  [AST.ParameterDeclaration.$type]: (parameter, ctx) => {
    if (parameter.defaultValue) {
      validateCapabilityTransport(parameter.defaultValue, Type.ofParameter(parameter), ctx)
    }
  },
  [AST.FunctionCallExpression.$type]: (call, ctx) => {
    if (AST.isFromExpression(call.$container) && call.$container.expression === call) {
      return
    }
    const resolved = ASTUtils.resolveFunctionInvocation(call)
    for (const pair of resolved.pairs) {
      validateCapabilityTransport(pair.argument.value, Type.ofParameter(pair.parameter), ctx)
    }
  },
  [AST.MethodCallExpression.$type]: (call, ctx) => {
    const resolved = ASTUtils.resolveAssociatedMethodInvocation(call)
    if (!resolved.descriptor) {
      return
    }
    const inputs = new Map(resolved.descriptor.signature.inputs.map(input => [input.declaration, input]))
    for (const pair of resolved.pairs) {
      const input = inputs.get(pair.parameter)
      if (input) {
        validateCapabilityTransport(pair.argument.value, input.type, ctx)
      }
    }
  },
} satisfies NodeValidationChecks

/** Unknown proof remains with admission diagnostics; only proved transport limits are reported. */
export function validateCapabilityTransport(
  value: AST.Expression,
  expected: ASTUtils.TaoType,
  ctx: ValidationContext,
): ASTUtils.CapabilityTransportResult {
  const actual = Type.ofExpression(value)
  const result = ASTUtils.planCapabilityTransport(actual, expected)
  if (result.kind === 'unsupported') {
    const name = Type.displayName(expected)
    const message = Switch.on<typeof result, 'reason', string | undefined>(result, 'reason', {
      'incompatible-types': () => undefined,
      'ambiguous-expected-union': () => CapabilityTransportValidationMessages.alternatives(name),
      'erased-union': () => CapabilityTransportValidationMessages.alternatives(name),
      'list-mapping': () => CapabilityTransportValidationMessages.list(name),
      'action-mapping': () => CapabilityTransportValidationMessages.action(name),
      'writable-input': () => CapabilityTransportValidationMessages.writable(name),
    })
    if (message) {
      ctx.error(value, message)
    }
  }
  return result
}
