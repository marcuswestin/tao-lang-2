import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { ValidationContext } from './validation'

/** dialogueValidationMessages declares ask/response diagnostics. */
const dialogueValidationMessages = {
  responseContext: '`respond` must be used inside a dialogue declaration.',
  duplicateResult: (name: string) => `Dialogue result '${name}' is declared more than once in this action block.`,
  missingArgument: (dialogue: string, parameter: string) =>
    `Ask of ${dialogue} is missing argument for parameter '${parameter}'.`,
  unmatchedArgument: (dialogue: string) =>
    `Ask of ${dialogue} has an argument that does not match any unbound parameter by type.`,
  ambiguousArgument: (dialogue: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Ask of ${dialogue} has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  ambiguousParameter: (dialogue: string, parameter: string) =>
    `Ask of ${dialogue} has multiple arguments that match parameter '${parameter}' by type.`,
  duplicateParameterType: (dialogue: string, parameter: string) =>
    `Dialogue ${dialogue} has more than one parameter with the same type near '${parameter}'.`,
  duplicateArgumentType: (dialogue: string) =>
    `Ask of ${dialogue} has more than one argument with the same exact type.`,
  unknownNamedArgument: (dialogue: string, name: string) => `Dialogue ${dialogue} has no parameter named '${name}'.`,
  duplicateNamedArgument: (dialogue: string, name: string) =>
    `Ask of ${dialogue} provides parameter '${name}' more than once.`,
  namedArgumentType: (dialogue: string, name: string, expected: string, actual: string) =>
    `Labeled argument '${name}:' of ${dialogue} expects ${expected}, got ${actual}.`,
} as const

/** DialogueValidator validates dialogue occurrence invocation and response ownership. */
export const DialogueValidator = {
  messages: dialogueValidationMessages,
  validate,
} as const

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const ask of AST.streamAllContents(file).filter(AST.isAskStatement)) {
    validateAsk(ask, ctx)
  }
  for (const respond of AST.streamAllContents(file).filter(AST.isRespondStatement)) {
    if (!AST.isDialogueDeclaration(AST.findOwningView(respond))) {
      ctx.error(dialogueValidationMessages.responseContext, respond)
    }
  }
  for (const block of AST.streamAllContents(file).filter(AST.isActionBlock)) {
    const seen = new Set<string>()
    for (const ask of AST.askDeclarationsOwnedByActionBlock(block)) {
      if (seen.has(ask.name)) {
        ctx.error(dialogueValidationMessages.duplicateResult(ask.name), ask)
      }
      seen.add(ask.name)
    }
  }
}

function validateAsk(ask: AST.AskStatement, ctx: ValidationContext): void {
  const dialogue = ask.dialogue.ref
  if (!dialogue) {
    return
  }
  const resolved = ASTUtils.resolveArgumentBindings(dialogue, ask)
  for (const diagnostic of resolved.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-argument': diagnostic => {
        ctx.error(
          dialogueValidationMessages.missingArgument(dialogue.name, Type.parameterName(diagnostic.parameter)),
          ask,
        )
      },
      'unmatched-argument': diagnostic => {
        ctx.error(dialogueValidationMessages.unmatchedArgument(dialogue.name), diagnostic.argument)
      },
      'ambiguous-argument': diagnostic => {
        ctx.error(
          dialogueValidationMessages.ambiguousArgument(dialogue.name, diagnostic.parameters),
          diagnostic.argument,
        )
      },
      'ambiguous-parameter': diagnostic => {
        ctx.error(
          dialogueValidationMessages.ambiguousParameter(
            dialogue.name,
            Type.parameterName(diagnostic.parameter),
          ),
          ask,
        )
      },
      'duplicate-argument-type': diagnostic => {
        ctx.error(dialogueValidationMessages.duplicateArgumentType(dialogue.name), diagnostic.argument)
      },
      'duplicate-parameter-type': diagnostic => {
        ctx.error(
          dialogueValidationMessages.duplicateParameterType(
            dialogue.name,
            Type.parameterName(diagnostic.parameter),
          ),
          ask,
        )
      },
      'unknown-named-argument': diagnostic => {
        ctx.error(
          dialogueValidationMessages.unknownNamedArgument(dialogue.name, diagnostic.name),
          diagnostic.argument,
        )
      },
      'duplicate-named-argument': diagnostic => {
        ctx.error(
          dialogueValidationMessages.duplicateNamedArgument(
            dialogue.name,
            Type.parameterName(diagnostic.parameter),
          ),
          diagnostic.argument,
        )
      },
      'named-argument-type': diagnostic => {
        ctx.error(
          dialogueValidationMessages.namedArgumentType(
            dialogue.name,
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
