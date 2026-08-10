import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
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
  unknownNamedArgument: (view: string, name: string) => `Renderable ${view} has no parameter named '${name}'.`,
  duplicateNamedArgument: (view: string, name: string) =>
    `Render of ${view} provides parameter '${name}' more than once.`,
  namedArgumentType: (view: string, name: string, expected: string, actual: string) =>
    `Named argument '.${name}' of ${view} expects ${expected}, got ${actual}.`,
} as const

/** InvocationsValidator validates render invocations through shared type-based binding diagnostics. */
export const InvocationsValidator = {
  messages: invocationValidationMessages,
  registerTypeValidation,
  validate,
}

/** validate validates structural render invocation diagnostics. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const render of AST.streamAllContents(file).filter(AST.isRender)) {
    reportInvocationDiagnostics(render, ctx)
  }
}

/** registerTypeValidation is intentionally empty; render argument assignability is checked by AST binding. */
function registerTypeValidation(_typir: TaoTypirServices): void {}

function reportInvocationDiagnostics(render: AST.Render, ctx: ValidationContext): void {
  const invocation = ASTUtils.resolveRenderInvocation(render)
  if (!invocation.view) {
    return
  }
  const view = invocation.view
  for (const diagnostic of invocation.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-argument': diagnostic => {
        ctx.error(
          invocationValidationMessages.missingArgument(view.name, Type.parameterName(diagnostic.parameter)),
          render,
        )
      },
      'unmatched-argument': diagnostic => {
        ctx.error(invocationValidationMessages.unmatchedArgument(view.name), diagnostic.argument)
      },
      'ambiguous-argument': diagnostic => {
        ctx.error(
          invocationValidationMessages.ambiguousArgument(view.name, diagnostic.parameters),
          diagnostic.argument,
        )
      },
      'ambiguous-parameter': diagnostic => {
        ctx.error(
          invocationValidationMessages.ambiguousParameter(
            view.name,
            Type.parameterName(diagnostic.parameter),
          ),
          render,
        )
      },
      'duplicate-argument-type': diagnostic => {
        ctx.error(invocationValidationMessages.duplicateArgumentType(view.name), diagnostic.argument)
      },
      'duplicate-parameter-type': diagnostic => {
        ctx.error(
          invocationValidationMessages.duplicateParameterType(
            view.name,
            Type.parameterName(diagnostic.parameter),
          ),
          render,
        )
      },
      'unknown-named-argument': diagnostic => {
        ctx.error(invocationValidationMessages.unknownNamedArgument(view.name, diagnostic.name), diagnostic.argument)
      },
      'duplicate-named-argument': diagnostic => {
        ctx.error(
          invocationValidationMessages.duplicateNamedArgument(view.name, Type.parameterName(diagnostic.parameter)),
          diagnostic.argument,
        )
      },
      'named-argument-type': diagnostic => {
        ctx.error(
          invocationValidationMessages.namedArgumentType(
            view.name,
            Type.parameterName(diagnostic.parameter),
            Type.displayName(Type.ofParameter(diagnostic.parameter)),
            Type.displayName(Type.ofArgument(diagnostic.argument)),
          ),
          diagnostic.argument,
        )
      },
    })
  }
}
