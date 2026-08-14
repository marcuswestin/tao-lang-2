import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** injectionValidationMessages declares inject argument diagnostics. */
export const injectionValidationMessages = {
  duplicateArgument: (name: string) => `Inject argument '${name}' is declared more than once.`,
} as const

/** injectionValidationChecks validates inject argument declarations. */
export const injectionValidationChecks = {
  [AST.Injection.$type]: reportDuplicateArguments,
} satisfies NodeValidationChecks

function reportDuplicateArguments(injection: AST.Injection, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const argument of AST.injectionArgumentsOf(injection)) {
    const name = ASTUtils.injectionArgumentName(argument)
    if (seen.has(name)) {
      ctx.error(injectionValidationMessages.duplicateArgument(name), argument)
      continue
    }
    seen.add(name)
  }
}
