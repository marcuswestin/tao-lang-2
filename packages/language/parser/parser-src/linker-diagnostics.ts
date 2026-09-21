import { declarationWord } from './grammar-words'
import * as AST from './parserASTExport'

type LinkerReference = AST.Document['references'][number]

/**
 * unresolvedReferenceMessage states an unresolved cross-reference in Tao's vocabulary, or returns
 * undefined when the grammar does not declare the property as a cross-reference and Langium's own
 * message is all there is. A grammar type name must not reach an author-facing diagnostic, but the
 * name and the position the author needs both survive here.
 */
export function unresolvedReferenceMessage(reference: LinkerReference): string | undefined {
  const info = reference.error?.info
  if (info === undefined) {
    return undefined
  }
  const referenceType = AST.reflection.getTypeMetaData(info.container.$type).properties[info.property]?.referenceType
  if (referenceType === undefined) {
    return undefined
  }
  return `No ${declarationWord(referenceType)} named '${reference.$refText}' is in scope.`
}

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
