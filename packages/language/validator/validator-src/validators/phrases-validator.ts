import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const messages = {
  duplicatePhraseParameter: (name: string) => `Parameter '${name}' is declared more than once in this phrase.`,
  phrasePlacement: 'Phrases must be declared at file level.',
  phraseMissingOther: (name: string) => `Phrase '${name}' must declare an 'other' form.`,
  phraseDuplicateCategory: (name: string, category: string) =>
    `Phrase '${name}' declares the '${category}' form more than once.`,
  phraseUnknownCategory: (name: string, category: string) =>
    `Phrase '${name}' has no plural category '${category}'; use one of ${ASTUtils.pluralCategories.join(', ')}.`,
  phraseNumberParameterCount: (name: string) =>
    `Phrase '${name}' has plural forms, so it must have exactly one 'number' parameter.`,
  phraseMissingArgument: (name: string, parameter: string) =>
    `Phrase '${name}' is missing argument for parameter '${parameter}'.`,
  phraseUnmatchedArgument: (name: string) =>
    `Phrase '${name}' has an argument that does not match any unbound parameter by type.`,
  phraseAmbiguousArgument: (name: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Phrase '${name}' has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  phraseAmbiguousParameter: (name: string, parameter: string) =>
    `Phrase '${name}' has multiple arguments that match parameter '${parameter}' by type.`,
  phraseDuplicateParameterType: (name: string, parameter: string) =>
    `Phrase '${name}' has more than one parameter with the same type near '${parameter}'.`,
  phraseDuplicateArgumentType: (name: string) =>
    `Phrase '${name}' has more than one argument with the same exact type.`,
  phraseUnknownLabel: (name: string, label: string) =>
    `Phrase '${name}' has no parameter named '${label}'; labels resolve only the invoked owner's parameters, not visible types.`,
  phraseDuplicateLabel: (name: string, label: string) =>
    `Phrase '${name}' receives parameter '${label}' more than once.`,
  phraseLabelType: (name: string, label: string, expected: string, actual: string) =>
    `Labeled argument '${label}:' of phrase '${name}' expects ${expected}, got ${actual}.`,
} as const

export const PhrasesValidator = {
  checks: {
    [AST.PhraseDeclaration.$type]: validatePhrase,
    [AST.FunctionCallExpression.$type]: validatePhraseCall,
  } satisfies NodeValidationChecks,
  messages,
} as const

function validatePhrase(phrase: AST.PhraseDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(phrase.$container)) {
    ctx.error(phrase, messages.phrasePlacement)
  }

  const seen = new Set<string>()
  for (const parameter of AST.parametersOf(phrase)) {
    const name = Type.parameterName(parameter)
    if (seen.has(name)) {
      ctx.error(parameter, messages.duplicatePhraseParameter(name))
    }
    seen.add(name)
  }

  if (!ASTUtils.phraseIsPlural(phrase)) {
    return
  }

  validatePluralForms(phrase, ctx)
  if (ASTUtils.phraseNumberParameters(phrase).length !== 1) {
    ctx.error(phrase, messages.phraseNumberParameterCount(phrase.name))
  }
}

function validatePluralForms(phrase: AST.PhraseDeclaration, ctx: ValidationContext): void {
  const seenCategories = new Set<string>()
  let hasOther = false
  for (const form of phrase.forms) {
    if (!ASTUtils.isPluralCategory(form.category)) {
      ctx.error(form, messages.phraseUnknownCategory(phrase.name, form.category))
      continue
    }
    if (seenCategories.has(form.category)) {
      ctx.error(form, messages.phraseDuplicateCategory(phrase.name, form.category))
    }
    seenCategories.add(form.category)
    hasOther ||= form.category === 'other'
  }
  if (!hasOther) {
    ctx.error(phrase, messages.phraseMissingOther(phrase.name))
  }
}

// A call shares its one shape with a pure-function call (Decisions §14); functions-validator owns those.
function validatePhraseCall(call: AST.FunctionCallExpression, ctx: ValidationContext): void {
  const resolved = ASTUtils.resolveFunctionInvocation(call)
  const phrase = resolved.function
  if (!phrase || !AST.isPhraseDeclaration(phrase)) {
    return
  }
  for (const diagnostic of resolved.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-argument': diagnostic => {
        ctx.error(call, messages.phraseMissingArgument(phrase.name, Type.parameterName(diagnostic.parameter)))
      },
      'unmatched-argument': diagnostic => {
        ctx.error(diagnostic.argument, messages.phraseUnmatchedArgument(phrase.name))
      },
      'ambiguous-argument': diagnostic => {
        ctx.error(diagnostic.argument, messages.phraseAmbiguousArgument(phrase.name, diagnostic.parameters))
      },
      'ambiguous-parameter': diagnostic => {
        ctx.error(call, messages.phraseAmbiguousParameter(phrase.name, Type.parameterName(diagnostic.parameter)))
      },
      'duplicate-argument-type': diagnostic => {
        ctx.error(diagnostic.argument, messages.phraseDuplicateArgumentType(phrase.name))
      },
      'duplicate-parameter-type': diagnostic => {
        ctx.error(call, messages.phraseDuplicateParameterType(phrase.name, Type.parameterName(diagnostic.parameter)))
      },
      'unknown-named-argument': diagnostic => {
        ctx.error(diagnostic.argument, messages.phraseUnknownLabel(phrase.name, diagnostic.name))
      },
      'duplicate-named-argument': diagnostic => {
        ctx.error(
          diagnostic.argument,
          messages.phraseDuplicateLabel(phrase.name, Type.parameterName(diagnostic.parameter)),
        )
      },
      'named-argument-type': diagnostic => {
        ctx.error(
          diagnostic.argument,
          messages.phraseLabelType(
            phrase.name,
            Type.parameterName(diagnostic.parameter),
            Type.displayName(Type.ofParameter(diagnostic.parameter)),
            Type.displayName(Type.ofArgument(diagnostic.argument)),
          ),
        )
      },
    })
  }
}
