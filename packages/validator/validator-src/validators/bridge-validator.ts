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
