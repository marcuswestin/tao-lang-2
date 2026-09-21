import type { ValidationOptions } from 'langium'
import type { Diagnostic } from 'vscode-languageserver'
import { Langium } from './langium-exports'
import { bridgesToATypeScriptExport } from './linker-diagnostics'

/** TaoDocumentValidator suppresses linker errors for TypeScript bridge export heads. */
export class TaoDocumentValidator extends Langium.DefaultDocumentValidator {
  protected override processLinkingErrors(
    document: Langium.LangiumDocument,
    diagnostics: Diagnostic[],
    _options: ValidationOptions,
  ): void {
    for (const reference of document.references) {
      const linkingError = reference.error
      if (!linkingError || bridgesToATypeScriptExport(reference)) {
        continue
      }
      const info = {
        node: linkingError.info.container,
        range: reference.$refNode?.range,
        property: linkingError.info.property,
        index: linkingError.info.index,
        data: {
          code: Langium.DocumentValidator.LinkingError,
          containerType: linkingError.info.container.$type,
          property: linkingError.info.property,
          refText: linkingError.info.reference.$refText,
        },
      }
      diagnostics.push(this.toDiagnostic('error', linkingError.message, info))
    }
  }
}
