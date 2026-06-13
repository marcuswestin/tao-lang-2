import { Packages } from '@ast-utils'
import { AST, Langium } from '@parser'
import type { Diagnostic } from '@shared'
import { validatorDiagnostic } from './diagnostics'
import type { TaoTypirServices } from './type-system'

/** ValidationRunContext declares shared validation invocation state. */
export interface ValidationRunContext {
  readonly packagesContext: Packages.Context
  readonly workspaceFiles: readonly AST.TaoFile[]
  readonly typir: TaoTypirServices
}

/** ValidationContext carries validation run state and diagnostic reporting. */
export interface ValidationContext extends ValidationRunContext {
  error(message: string, node: AST.Node): void
}

/** createValidationContext creates a validator context backed by a Langium acceptor. */
export function createValidationContext(
  accept: Langium.ValidationAcceptor,
  runContext: ValidationRunContext,
): ValidationContext {
  return {
    ...runContext,
    error(message: string, node: AST.Node) {
      accept('error', message, { node })
    },
  }
}

/** collectValidationDiagnostics creates a Langium acceptor that stores Tao diagnostics. */
export function collectValidationDiagnostics(): {
  accept: Langium.ValidationAcceptor
  diagnostics: readonly Diagnostic[]
} {
  const diagnostics: Diagnostic[] = []
  const accept: Langium.ValidationAcceptor = (severity, message, info) => {
    diagnostics.push(validatorDiagnostic(severity, message, info.node as AST.Node))
  }
  return { accept, diagnostics }
}
