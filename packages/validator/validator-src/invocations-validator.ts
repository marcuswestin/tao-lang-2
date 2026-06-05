import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** invocationValidationMessages declares render invocation diagnostics. */
export const invocationValidationMessages = {
  missingArgument: (view: string, parameter: string) =>
    `Render of ${view} is missing argument for parameter '${parameter}'.`,
  extraArguments: (view: string, expected: number, actual: number) =>
    `Render of ${view} expects ${expected} argument(s), found ${actual}.`,
  typeMismatch: (parameter: AST.ParameterDeclaration, actual: string) =>
    `Argument for parameter '${parameter.name}' expects ${parameter.type}, got ${actual}.`,
} as const

/** validateInvocations validates structural render invocation diagnostics. */
export function validateInvocations(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const render of ASTUtils.streamAllContents(file).filter(AST.isRender)) {
    reportArity(render, ctx)
  }
}

function reportArity(render: AST.Render, ctx: ValidationContext): void {
  const view = render.view?.ref
  if (!view) {
    return
  }

  const parameters = view.parameterList?.parameters ?? []
  const args = render.argumentList?.arguments ?? []

  for (const parameter of parameters.slice(args.length)) {
    ctx.error(invocationValidationMessages.missingArgument(view.name, parameter.name), render)
  }
  if (args.length > parameters.length) {
    ctx.error(
      invocationValidationMessages.extraArguments(
        view.name,
        parameters.length,
        args.length,
      ),
      args[parameters.length],
    )
  }
}
