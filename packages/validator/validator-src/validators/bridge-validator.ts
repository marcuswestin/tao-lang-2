import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'

export const bridgeValidationMessages = {
  head: 'An expression bridged with `from` is a named export or a call to one.',
  untyped: 'A value bridged with `from` needs a declared type: a `returns` clause, or `let Name is Type =`.',
  path: (path: string) => `A bridged expression names a TypeScript sidecar; '${path}' is not one.`,
} as const

/**
 * `<expression> from <path>` (Decisions §15) is the whole TypeScript boundary for values. Tao owns
 * the type, so the declaration around a bridged value must state one; the module owns the
 * implementation, so the expression's head names one of its exports.
 */
export const bridgeValidationChecks = {
  [AST.FromExpression.$type]: (bridge, ctx) => {
    if (!bridge.path.endsWith('.ts') && !bridge.path.endsWith('.tsx')) {
      ctx.error(bridgeValidationMessages.path(bridge.path), bridge)
    }
    if (!AST.isFunctionCallExpression(bridge.expression) && !AST.isValueReference(bridge.expression)) {
      ctx.error(bridgeValidationMessages.head, bridge)
      return
    }
    if (!declaresBridgedType(bridge)) {
      ctx.error(bridgeValidationMessages.untyped, bridge)
    }
  },
} satisfies NodeValidationChecks

function declaresBridgedType(bridge: AST.FromExpression): boolean {
  const container = bridge.$container
  if (AST.isReturnStatement(container)) {
    const owner = AST.findOwningFunction(container)
    return owner?.returnType !== undefined
  }
  return AST.isAliasDeclaration(container) && container.type !== undefined
}
