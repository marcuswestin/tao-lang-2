import { AST, Langium } from '@parser'
import { type TaoDiagnostic, validatorError } from './diagnostics'

/** ValidationContext collects Tao validator diagnostics. */
export type ValidationContext = {
  readonly diagnostics: readonly TaoDiagnostic[]
  error(message: string, node?: AST.Node): void
}

/** createValidationContext creates a collecting validator context. */
export function createValidationContext(): ValidationContext {
  const diagnostics: TaoDiagnostic[] = []
  return {
    diagnostics,
    error(message: string, node?: AST.Node) {
      diagnostics.push(validatorError(message, node))
    },
  }
}

/** createLangiumValidationContext creates a validator context backed by Langium diagnostics. */
export function createLangiumValidationContext(
  accept: Langium.ValidationAcceptor,
  fallback: AST.Node,
): ValidationContext {
  return {
    diagnostics: [],
    error(message: string, node?: AST.Node) {
      accept('error', message, { node: node ?? fallback })
    },
  }
}
