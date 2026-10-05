import type { Packages } from '@ast-utils'
import type { AST, Langium, ProjectGraph } from '@parser'
import type { Diagnostic, ReleaseProfile } from '@shared'
import { validatorDiagnostic } from './diagnostics'

/** AppValidationMemo holds only app helper results from one completed linked-AST batch. */
export interface AppValidationMemo {
  values(file: AST.TaoFile, compute: () => readonly AST.AppValueDeclaration[]): readonly AST.AppValueDeclaration[]
  identities(
    packagesContext: Packages.Context,
    files: readonly AST.TaoFile[],
    compute: () => ReadonlyMap<string, AST.AppValueDeclaration>,
  ): ReadonlyMap<string, AST.AppValueDeclaration>
}

/** ValidationRunContext declares shared validation invocation state. */
export interface ValidationRunContext {
  readonly releaseProfile?: ReleaseProfile
  readonly packagesContext: Packages.Context
  readonly entryFilePath: string
  readonly workspaceFiles: readonly AST.TaoFile[]
  /**
   * Every Tao file the surrounding batch validates, when one entry's own graph is only part of it.
   * Project identity is checked-in metadata at a project root, not something an entry's imports
   * decide, so it is read from here rather than from `workspaceFiles`. Defaults to `workspaceFiles`.
   */
  readonly projectFiles?: readonly AST.TaoFile[]
  /** One Langium document-build batch shares read-only workspace indexes across its file checks. */
  readonly memoStore?: Map<string, unknown>
  /** Requirement graphs may be shared across equivalent entries in one parsed batch. */
  readonly requirementGraph?: () => ProjectGraph
  /** App helpers may reuse exact AST inputs only inside one parsed batch. */
  readonly appMemo?: AppValidationMemo
  /** Descendant snapshots may be reused only inside one completed, unmodified parsed batch. */
  readonly nodesInFile?: (file: AST.TaoFile) => readonly AST.Node[]
}

/** ValidationContext carries validation run state and diagnostic reporting. */
export interface ValidationContext extends ValidationRunContext {
  /**
   * memo computes a workspace-wide index once per validation run. Validators that need every file's
   * declarations, renders, or primitives call this instead of walking `workspaceFiles` per file, so a
   * run over n files stays O(n) rather than O(n²). The key names the index; the run holds the value.
   */
  memo<T>(key: string, compute: () => T): T
  error(node: AST.Node, message: string, opts?: DiagnosticOptions): void
  warning(node: AST.Node, message: string, opts?: DiagnosticOptions): void
  /** hint names something the source could do better without being wrong: it never fails a check. */
  hint(node: AST.Node, message: string, opts?: DiagnosticOptions): void
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
  const memos = runContext.memoStore ?? new Map<string, unknown>()
  return {
    ...runContext,
    memo<T>(key: string, compute: () => T): T {
      if (!memos.has(key)) {
        memos.set(key, compute())
      }
      return memos.get(key) as T
    },
    error(node: AST.Node, message: string, opts?: DiagnosticOptions) {
      accept('error', message, { node, code: opts?.code })
    },
    warning(node: AST.Node, message: string, opts?: DiagnosticOptions) {
      accept('warning', message, { node, code: opts?.code })
    },
    hint(node: AST.Node, message: string, opts?: DiagnosticOptions) {
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
    diagnostics.push(validatorDiagnostic(severity, info.node as AST.Node, message, {
      code: info.code === undefined ? undefined : String(info.code),
    }))
  }
  return { accept, diagnostics }
}
