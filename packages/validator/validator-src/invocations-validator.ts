import ASTUtils, { Type } from '@ast-utils'
import { AST } from '@parser'
import type { TaoTypirServices } from './TypeSystemHelpers'
import type { ValidationContext } from './validation'

/** invocationValidationMessages declares render invocation diagnostics. */
const invocationValidationMessages = {
  missingArgument: (view: string, parameter: string) =>
    `Render of ${view} is missing argument for parameter '${parameter}'.`,
  unmatchedArgument: (view: string) =>
    `Render of ${view} has an argument that does not match any unbound parameter by type.`,
  ambiguousArgument: (view: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Render of ${view} has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  ambiguousParameter: (view: string, parameter: string) =>
    `Render of ${view} has multiple arguments that match parameter '${parameter}' by type.`,
  duplicateParameterType: (view: string, parameter: string) =>
    `Renderable ${view} has more than one parameter with the same type near '${parameter}'.`,
  duplicateArgumentType: (view: string) => `Render of ${view} has more than one argument with the same exact type.`,
} as const

/** InvocationsValidator validates render invocations and Typir argument checks. */
export const InvocationsValidator = {
  messages: invocationValidationMessages,
  registerTypeValidation,
  validate,
}

/** validate validates structural render invocation diagnostics. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const render of ASTUtils.streamAllContents(file).filter(AST.isRender)) {
    reportInvocationDiagnostics(render, ctx)
  }
}

/** registerTypeValidation preserves the Typir initialization hook for future expression rules. */
function registerTypeValidation(_typir: TaoTypirServices): void {}

function reportInvocationDiagnostics(render: AST.Render, ctx: ValidationContext): void {
  const invocation = ASTUtils.resolveRenderInvocation(render)
  if (!invocation.view) {
    return
  }
  for (const diagnostic of invocation.diagnostics) {
    if (diagnostic.kind === 'missing-argument') {
      ctx.error(
        invocationValidationMessages.missingArgument(
          invocation.view.name,
          Type.parameterName(diagnostic.parameter),
        ),
        render,
      )
      continue
    }
    if (diagnostic.kind === 'unmatched-argument') {
      ctx.error(invocationValidationMessages.unmatchedArgument(invocation.view.name), diagnostic.argument)
      continue
    }
    if (diagnostic.kind === 'ambiguous-argument') {
      ctx.error(
        invocationValidationMessages.ambiguousArgument(invocation.view.name, diagnostic.parameters),
        diagnostic.argument,
      )
      continue
    }
    if (diagnostic.kind === 'ambiguous-parameter') {
      ctx.error(
        invocationValidationMessages.ambiguousParameter(
          invocation.view.name,
          Type.parameterName(diagnostic.parameter),
        ),
        render,
      )
      continue
    }
    if (diagnostic.kind === 'duplicate-argument-type') {
      ctx.error(invocationValidationMessages.duplicateArgumentType(invocation.view.name), diagnostic.argument)
      continue
    }
    ctx.error(
      invocationValidationMessages.duplicateParameterType(
        invocation.view.name,
        Type.parameterName(diagnostic.parameter),
      ),
      render,
    )
  }
}
