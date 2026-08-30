import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** responseValidationMessages declares ask/response diagnostics. */
const responseValidationMessages = {
  responseContext: '`respond` must be used inside a view that declares `responds`.',
  askTarget: (name: string) => `Ask target '${name}' must be a view that declares \`responds\`.`,
  duplicateResult: (name: string) => `Ask result '${name}' is declared more than once in this action block.`,
  missingArgument: (view: string, parameter: string) =>
    `Ask of ${view} is missing argument for parameter '${parameter}'.`,
  unmatchedArgument: (view: string) =>
    `Ask of ${view} has an argument that does not match any unbound parameter by type.`,
  ambiguousArgument: (view: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Ask of ${view} has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  ambiguousParameter: (view: string, parameter: string) =>
    `Ask of ${view} has multiple arguments that match parameter '${parameter}' by type.`,
  duplicateParameterType: (view: string, parameter: string) =>
    `View ${view} has more than one parameter with the same type near '${parameter}'.`,
  duplicateArgumentType: (view: string) =>
    `Ask of ${view} has more than one argument with the same exact type.`,
  unknownNamedArgument: (view: string, name: string) => `View ${view} has no parameter named '${name}'.`,
  duplicateNamedArgument: (view: string, name: string) =>
    `Ask of ${view} provides parameter '${name}' more than once.`,
  namedArgumentType: (view: string, name: string, expected: string, actual: string) =>
    `Labeled argument '${name}:' of ${view} expects ${expected}, got ${actual}.`,
} as const

/** ResponsesValidator validates ask invocation and response ownership. */
export const ResponsesValidator = {
  checks: {
    [AST.AskStatement.$type]: validateAsk,
    [AST.RespondStatement.$type]: (respond, ctx) => {
      // `respond` is legal only in a view that promises a typed answer with `responds`.
      const owner = AST.findOwningView(respond)
      if (!owner?.response) {
        ctx.error(responseValidationMessages.responseContext, respond)
      }
    },
    [AST.ActionBlock.$type]: (block, ctx) => {
      const seen = new Set<string>()
      for (const ask of AST.askDeclarationsOwnedByActionBlock(block)) {
        if (seen.has(ask.name)) {
          ctx.error(responseValidationMessages.duplicateResult(ask.name), ask)
        }
        seen.add(ask.name)
      }
    },
  } satisfies NodeValidationChecks,
  messages: responseValidationMessages,
} as const

function validateAsk(ask: AST.AskStatement, ctx: ValidationContext): void {
  const view = ask.view.ref
  if (!view) {
    return
  }
  // `ask` answers with the target's `responds` type, so a view without one cannot be asked.
  if (!view.response) {
    ctx.error(responseValidationMessages.askTarget(view.name), ask)
  }
  const resolved = ASTUtils.resolveArgumentBindings(view, ask)
  for (const diagnostic of resolved.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-argument': diagnostic => {
        ctx.error(
          responseValidationMessages.missingArgument(view.name, Type.parameterName(diagnostic.parameter)),
          ask,
        )
      },
      'unmatched-argument': diagnostic => {
        ctx.error(responseValidationMessages.unmatchedArgument(view.name), diagnostic.argument)
      },
      'ambiguous-argument': diagnostic => {
        ctx.error(
          responseValidationMessages.ambiguousArgument(view.name, diagnostic.parameters),
          diagnostic.argument,
        )
      },
      'ambiguous-parameter': diagnostic => {
        ctx.error(
          responseValidationMessages.ambiguousParameter(
            view.name,
            Type.parameterName(diagnostic.parameter),
          ),
          ask,
        )
      },
      'duplicate-argument-type': diagnostic => {
        ctx.error(responseValidationMessages.duplicateArgumentType(view.name), diagnostic.argument)
      },
      'duplicate-parameter-type': diagnostic => {
        ctx.error(
          responseValidationMessages.duplicateParameterType(
            view.name,
            Type.parameterName(diagnostic.parameter),
          ),
          ask,
        )
      },
      'unknown-named-argument': diagnostic => {
        ctx.error(
          responseValidationMessages.unknownNamedArgument(view.name, diagnostic.name),
          diagnostic.argument,
        )
      },
      'duplicate-named-argument': diagnostic => {
        ctx.error(
          responseValidationMessages.duplicateNamedArgument(
            view.name,
            Type.parameterName(diagnostic.parameter),
          ),
          diagnostic.argument,
        )
      },
      'named-argument-type': diagnostic => {
        ctx.error(
          responseValidationMessages.namedArgumentType(
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
