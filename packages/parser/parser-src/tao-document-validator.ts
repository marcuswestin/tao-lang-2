import { DefaultDocumentValidator, type LangiumDocument, type ValidationOptions } from 'langium'
import * as AST from './parserASTExport'

type LinkedReference = LangiumDocument['references'][number]
type Diagnostic = NonNullable<LangiumDocument['diagnostics']>[number]

/**
 * The head name of a bridged expression names a TypeScript export (Decisions §15), so it is not
 * expected to resolve in Tao scope and an unresolved reference there is not a linking error. Its
 * arguments are ordinary Tao values and still have to resolve, so only the head is exempt.
 */
export function bridgesToATypeScriptExport(reference: LinkedReference): boolean {
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

/**
 * TaoDocumentValidator is where Langium turns unresolved references into diagnostics, for the
 * language server and the command line alike. The bridge exemption lives here rather than in either
 * caller, so an editor never reports a TypeScript export as a missing Tao declaration while the CLI
 * stays quiet about the same line.
 */
export class TaoDocumentValidator extends DefaultDocumentValidator {
  protected override processLinkingErrors(
    document: LangiumDocument,
    diagnostics: Diagnostic[],
    options: ValidationOptions,
  ): void {
    const exempt = document.references.filter(bridgesToATypeScriptExport)
    if (exempt.length === 0) {
      super.processLinkingErrors(document, diagnostics, options)
      return
    }
    const reported = { ...document, references: document.references.filter(reference => !exempt.includes(reference)) }
    super.processLinkingErrors(reported as LangiumDocument, diagnostics, options)
  }
}
