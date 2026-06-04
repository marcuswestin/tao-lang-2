import { AST, Langium } from '@parser'
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

/** RenderInvocationPair declares one positional render argument-to-parameter pairing. */
export type RenderInvocationPair = {
  argument: AST.Argument
  parameter: AST.ParameterDeclaration
}

/** RenderInvocation declares a resolved render invocation shape. */
export type RenderInvocation = {
  render: AST.Render
  view?: AST.ViewDeclaration
  pairs: RenderInvocationPair[]
}

/** validateInvocations validates structural render invocation diagnostics. */
export function validateInvocations(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const render of Langium.AstUtils.streamAllContents(file).filter(AST.isRender)) {
    resolveRenderInvocation(render, ctx)
  }
}

/** resolveRenderInvocation resolves a render target and positional argument pairs. */
export function resolveRenderInvocation(render: AST.Render, ctx?: ValidationContext): RenderInvocation {
  const view = render.view?.ref
  if (!view) {
    return { render, pairs: [] }
  }

  const parameters = view.parameterList?.parameters ?? []
  const args = render.argumentList?.arguments ?? []
  if (ctx) {
    reportArity(view, parameters, args, ctx)
  }

  return {
    render,
    view,
    pairs: parameters.slice(0, args.length).map((parameter, index) => ({
      argument: args[index]!,
      parameter,
    })),
  }
}

function reportArity(
  view: AST.ViewDeclaration,
  parameters: readonly AST.ParameterDeclaration[],
  args: readonly AST.Argument[],
  ctx: ValidationContext,
): void {
  for (const parameter of parameters.slice(args.length)) {
    ctx.error(invocationValidationMessages.missingArgument(view.name, parameter.name), parameter)
  }
  if (args.length > parameters.length) {
    ctx.error(
      invocationValidationMessages.extraArguments(view.name, parameters.length, args.length),
      args[parameters.length],
    )
  }
}
