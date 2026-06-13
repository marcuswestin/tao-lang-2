import { Packages } from '@ast-utils'
import { AST, Langium } from '@parser'
import type { Diagnostic } from '@shared'
import { validatorDiagnostic } from './diagnostics'
import type { TaoTypirServices } from './type-system'

/** ValidationRunContext declares shared validation invocation state. */
export interface ValidationRunContext {
  readonly packagesContext: Packages.Context
  readonly entryFilePath: string
  readonly workspaceFiles: readonly AST.TaoFile[]
  readonly typir: TaoTypirServices
}

/** ValidationContext carries validation run state and diagnostic reporting. */
export interface ValidationContext extends ValidationRunContext {
  error(message: string, node: AST.Node, opts?: DiagnosticOptions): void
  warning(message: string, node: AST.Node, opts?: DiagnosticOptions): void
}

/** DiagnosticOptions declares optional diagnostic metadata such as quick-fix codes. */
export type DiagnosticOptions = {
  code?: string
}

/** createValidationContext creates a validator context backed by a Langium acceptor. */
export function createValidationContext(
  accept: Langium.ValidationAcceptor,
  runContext: ValidationRunContext,
): ValidationContext {
  return {
    ...runContext,
    error(message: string, node: AST.Node, opts?: DiagnosticOptions) {
      accept('error', message, { node, code: opts?.code })
    },
    warning(message: string, node: AST.Node, opts?: DiagnosticOptions) {
      accept('warning', message, { node, code: opts?.code })
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
    diagnostics.push(validatorDiagnostic(severity, message, info.node as AST.Node, {
      code: info.code === undefined ? undefined : String(info.code),
    }))
  }
  return { accept, diagnostics }
}
