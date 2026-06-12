import { AST, Langium } from '@parser'
import { type TaoDiagnostic, validatorError, validatorWarning } from './diagnostics'

/** DiagnosticOptions declares optional diagnostic metadata such as quick-fix codes. */
export type DiagnosticOptions = {
  code?: string
}

/** ValidationContext collects Tao validator diagnostics. */
export type ValidationContext = {
  readonly diagnostics: readonly TaoDiagnostic[]
  error(message: string, node?: AST.Node, opts?: DiagnosticOptions): void
  warning(message: string, node?: AST.Node, opts?: DiagnosticOptions): void
}

/** createValidationContext creates a collecting validator context. */
export function createValidationContext(): ValidationContext {
  const diagnostics: TaoDiagnostic[] = []
  return {
    diagnostics,
    error(message: string, node?: AST.Node, opts?: DiagnosticOptions) {
      diagnostics.push(validatorError(message, node, opts))
    },
    warning(message: string, node?: AST.Node, opts?: DiagnosticOptions) {
      diagnostics.push(validatorWarning(message, node, opts))
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
    error(message: string, node?: AST.Node, opts?: DiagnosticOptions) {
      accept('error', message, { node: node ?? fallback, code: opts?.code })
    },
    warning(message: string, node?: AST.Node, opts?: DiagnosticOptions) {
      accept('warning', message, { node: node ?? fallback, code: opts?.code })
    },
  }
}
