import type { Packages } from '@ast-utils'
import type { AST, Langium } from '@parser'
import type { Diagnostic } from '@shared'
import { validatorDiagnostic } from './diagnostics'

/** ValidationRunContext declares shared validation invocation state. */
export interface ValidationRunContext {
  readonly packagesContext: Packages.Context
  readonly entryFilePath: string
  readonly workspaceFiles: readonly AST.TaoFile[]
}

/** ValidationContext carries validation run state and diagnostic reporting. */
export interface ValidationContext extends ValidationRunContext {
  /**
   * memo computes a workspace-wide index once per validation run. Validators that need every file's
   * declarations, renders, or primitives call this instead of walking `workspaceFiles` per file, so a
   * run over n files stays O(n) rather than O(n²). The key names the index; the run holds the value.
   */
  memo<T>(key: string, compute: () => T): T
  error(message: string, node: AST.Node, opts?: DiagnosticOptions): void
  warning(message: string, node: AST.Node, opts?: DiagnosticOptions): void
  /** hint names something the source could do better without being wrong: it never fails a check. */
  hint(message: string, node: AST.Node, opts?: DiagnosticOptions): void
}

/** DiagnosticOptions declares optional diagnostic metadata such as quick-fix codes. */
type DiagnosticOptions = {
  code?: string
}

/** Validation creates validator contexts and diagnostic collectors. */
export const Validation = {
  collectDiagnostics,
  createContext,
}

/** createValidationContext creates a validator context backed by a Langium acceptor. */
function createContext(
  accept: Langium.ValidationAcceptor,
  runContext: ValidationRunContext,
): ValidationContext {
  const memos = new Map<string, unknown>()
  return {
    ...runContext,
    memo<T>(key: string, compute: () => T): T {
      if (!memos.has(key)) {
        memos.set(key, compute())
      }
      return memos.get(key) as T
    },
    error(message: string, node: AST.Node, opts?: DiagnosticOptions) {
      accept('error', message, { node, code: opts?.code })
    },
    warning(message: string, node: AST.Node, opts?: DiagnosticOptions) {
      accept('warning', message, { node, code: opts?.code })
    },
    hint(message: string, node: AST.Node, opts?: DiagnosticOptions) {
      accept('hint', message, { node, code: opts?.code })
    },
  }
}

/** collectValidationDiagnostics creates a Langium acceptor that stores Tao diagnostics. */
function collectDiagnostics(): {
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
