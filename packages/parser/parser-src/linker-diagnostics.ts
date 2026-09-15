import * as AST from './parserASTExport'

type LinkerReference = AST.Document['references'][number]

/**
 * The head name of a bridged expression names a TypeScript export (Decisions §15), so it is not
 * expected to resolve in Tao scope and an unresolved reference there is not a linking error. Its
 * arguments are ordinary Tao values and still have to resolve, so only the head is exempt.
 */
export function bridgesToATypeScriptExport(reference: LinkerReference): boolean {
  const info = reference.error?.info
  const container = info?.container
  if (!container || !AST.isFromExpression(container.$container)) {
    return false
  }
  const bridged = container.$container.expression
  if (AST.isFunctionCallExpression(container)) {
    return container === bridged && info.property === 'function'
  }
  return AST.isValueReference(container) && container === bridged && info.property === 'target'
}
