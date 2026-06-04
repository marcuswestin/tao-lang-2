import { AST } from '@parser'
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
