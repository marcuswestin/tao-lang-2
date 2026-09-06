import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** injectionValidationMessages declares inject argument diagnostics. */
export const injectionValidationMessages = {
  duplicateArgument: (name: string) => `Inject argument '${name}' is declared more than once.`,
  ambientRenderOnly: 'Ambient render channels are only available to a render inject implementation.',
} as const

/** injectionValidationChecks validates inject argument declarations. */
export const injectionValidationChecks = {
  [AST.Injection.$type]: reportDuplicateArguments,
} satisfies NodeValidationChecks

function reportDuplicateArguments(
  injection: AST.Injection,
  ctx: ValidationContext,
): void {
  const seen = new Set<string>()
  for (const argument of AST.injectionArgumentsOf(injection)) {
    const name = ASTUtils.injectionArgumentName(argument)
    if (seen.has(name)) {
      ctx.error(argument, injectionValidationMessages.duplicateArgument(name))
      continue
    }
    seen.add(name)
  }
  validateAmbientChannels(injection, ctx)
}

function validateAmbientChannels(
  injection: AST.Injection,
  ctx: ValidationContext,
): void {
  const render = injection.$container
  const isRenderInjection = AST.isRenderStatement(render) && render.injection === injection
  for (const argument of AST.injectionArgumentsOf(injection).filter(AST.isNamedInjectionArgument)) {
    const ambient = argument.ambient
    if (!ambient) {
      continue
    }
    if (!isRenderInjection) {
      ctx.error(ambient, injectionValidationMessages.ambientRenderOnly)
      continue
    }
  }
}
