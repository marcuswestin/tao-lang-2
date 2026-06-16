import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import type { ValidationProblemAcceptor } from 'typir'
import { type TaoSpecifics, type TaoTypirServices, TypeSystemHelpers } from './TypeSystemHelpers'
import type { ValidationContext } from './validation'

/** invocationValidationMessages declares render invocation diagnostics. */
const invocationValidationMessages = {
  missingArgument: (view: string, parameter: string) =>
    `Render of ${view} is missing argument for parameter '${parameter}'.`,
  extraArguments: (view: string, expected: number, actual: number) =>
    `Render of ${view} expects ${expected} argument(s), found ${actual}.`,
  typeMismatch: (parameter: AST.ParameterDeclaration, actual: string) =>
    `Argument for parameter '${parameter.name}' expects ${parameter.type}, got ${actual}.`,
} as const

/** InvocationsValidator validates render invocations and Typir argument checks. */
export const InvocationsValidator = {
  messages: invocationValidationMessages,
  registerTypeValidation,
  validate,
}

/** validateInvocations validates structural render invocation diagnostics. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const render of ASTUtils.streamAllContents(file).filter(AST.isRender)) {
    reportArity(render, ctx)
  }
}

/** registerInvocationTypeValidation registers Typir checks for render argument compatibility. */
function registerTypeValidation(typir: TaoTypirServices): void {
  typir.validation.Collector.addValidationRulesForAstNodes({
    RenderStatement: (render, accept, services) => {
      validateInvocationTypes(render, accept, services as TaoTypirServices)
    },
    ViewRender: (render, accept, services) => {
      validateInvocationTypes(render, accept, services as TaoTypirServices)
    },
  })
}

function reportArity(render: AST.Render, ctx: ValidationContext): void {
  const invocation = ASTUtils.resolveRenderInvocation(render)
  if (!invocation.view) {
    return
  }

  const arity = ASTUtils.invocationArity(invocation, invocation.view, render)

  for (const parameter of arity.parameters.slice(arity.pairCount)) {
    ctx.error(invocationValidationMessages.missingArgument(invocation.view.name, parameter.name), render)
  }
  if (arity.args.length > arity.pairCount) {
    const extraArgument = arity.args[arity.pairCount]
    Assert.defined(extraArgument, 'extra render argument exists', {
      argumentCount: arity.args.length,
      pairCount: arity.pairCount,
    })
    ctx.error(
      invocationValidationMessages.extraArguments(
        invocation.view.name,
        arity.parameters.length,
        arity.args.length,
      ),
      extraArgument,
    )
  }
}

function validateInvocationTypes(
  render: AST.Render,
  accept: ValidationProblemAcceptor<TaoSpecifics>,
  services: TaoTypirServices,
): void {
  const invocation = ASTUtils.resolveRenderInvocation(render)
  for (const pair of invocation.pairs) {
    const expected = TypeSystemHelpers.taoPrimitiveType(pair.parameter.type, services)
    services.validation.Constraints.ensureNodeIsAssignable(pair.argument.value, expected, accept, (actual) => ({
      languageNode: pair.argument.value,
      message: invocationValidationMessages.typeMismatch(pair.parameter, actual.name),
    }))
  }
}
