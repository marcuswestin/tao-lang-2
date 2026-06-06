import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** injectionValidationMessages declares inject argument diagnostics. */
export const injectionValidationMessages = {
  duplicateArgument: (name: string) => `Inject argument '${name}' is declared more than once.`,
} as const

/** validateInjections validates inject argument declarations. */
export function validateInjections(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const injection of ASTUtils.streamAllContents(file).filter(AST.isInjection)) {
    reportDuplicateArguments(injection, ctx)
  }
}

function reportDuplicateArguments(injection: AST.Injection, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const argument of injection.argumentList?.arguments ?? []) {
    const name = ASTUtils.injectionArgumentName(argument)
    if (seen.has(name)) {
      ctx.error(injectionValidationMessages.duplicateArgument(name), argument)
      continue
    }
    seen.add(name)
  }
}
