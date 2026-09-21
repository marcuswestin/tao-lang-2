import { AST } from '@parser'
import { FS } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

export const bridgeValidationMessages = {
  head: 'An expression bridged with `from` is a named export or a call to one.',
  untyped: 'A value bridged with `from` needs a declared type: a `returns` clause, or `let Name is Type =`.',
  path: (path: string) => `A bridged expression names a TypeScript sidecar; '${path}' is not one.`,
  missing: (path: string) => `Bridged TypeScript sidecar '${path}' does not exist.`,
} as const

/**
 * `<expression> from <path>` (Decisions §15) is the whole TypeScript boundary for values. Tao owns
 * the type, so the declaration around a bridged value must state one; the module owns the
 * implementation, so the expression's head names one of its exports.
 */
export const bridgeValidationChecks = {
  [AST.FromExpression.$type]: (bridge, ctx) => {
    if (!bridgePathIsSidecar(bridge.path)) {
      ctx.error(bridge, bridgeValidationMessages.path(bridge.path))
    }
    if (!AST.isFunctionCallExpression(bridge.expression) && !AST.isValueReference(bridge.expression)) {
      ctx.error(bridge, bridgeValidationMessages.head)
      return
    }
    if (!declaresBridgedType(bridge)) {
      ctx.error(bridge, bridgeValidationMessages.untyped)
    }
  },
} satisfies NodeValidationChecks

/**
 * validateBridgedSidecarFiles checks that each bridged sidecar exists, the way foreign views,
 * foreign actions, and configuration implementations already check theirs. The compiler resolves a
 * bridge path against its own declaring document and asserts the file is there before emitting an
 * import of it, so a missing sidecar has to be a diagnostic rather than a compile-time crash.
 */
export async function validateBridgedSidecarFiles(file: AST.TaoFile, ctx: ValidationContext): Promise<void> {
  for (const bridge of AST.streamAllContents(file).filter(AST.isFromExpression)) {
    if (!bridgePathIsSidecar(bridge.path)) {
      continue
    }
    const documentDirectory = FS.resolvePath(FS.dirname(AST.getDocument(bridge).uri.path))
    // A synthetic in-memory document has no directory to read, so only path-shape rules apply.
    if (
      await FS.isDirectory(documentDirectory)
      && !await FS.exists(FS.resolvePath(bridge.path, documentDirectory))
    ) {
      ctx.error(bridge, bridgeValidationMessages.missing(bridge.path))
    }
  }
}

function bridgePathIsSidecar(path: string): boolean {
  return path.endsWith('.ts') || path.endsWith('.tsx')
}

function declaresBridgedType(bridge: AST.FromExpression): boolean {
  const container = bridge.$container
  if (AST.isReturnStatement(container)) {
    const owner = AST.findOwningFunction(container)
    return owner?.returnType !== undefined
  }
  if (AST.isAliasDeclaration(container)) {
    return container.type !== undefined
  }
  // A configuration slot default types its bridge in place: `Adapter item is HNAdapter from ./X.ts`.
  if (AST.isTypeProperty(container)) {
    return container.type !== undefined
  }
  return AST.isConfigurationPropertyDeclaration(container)
}
