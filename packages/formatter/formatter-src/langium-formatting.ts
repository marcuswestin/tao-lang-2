import { AST, Langium } from '@parser'
import { Assert } from '@shared'
import { Format } from './Format'
import { reindentInjectionFences } from './formatters/injections-formatter'
import { collapseClosingBraces } from './formatters/statements-formatter'
import { applyTextEdits, createNodeFormat, finalizeFormattedText, type FormattedNodeType } from './formatting'

/** TaoFormatter formats Tao documents by dispatching per-node Format handlers. */
export class TaoFormatter extends Langium.AbstractFormatter {
  /** formatDocument chains Langium edits with the Tao text post-passes so every host formats identically. */
  override async formatDocument(
    document: Langium.LangiumDocument,
    params: Langium.DocumentFormattingParams,
  ): Promise<Langium.TextEdit[]> {
    const edits = await super.formatDocument(document, params)
    const formatted = applyTextEdits(document as AST.Document, edits)
    const tab = ' '.repeat(params.options.tabSize)
    const finalText = finalizeFormattedText(collapseClosingBraces(reindentInjectionFences(formatted, tab)))
    if (finalText === formatted) {
      return edits
    }
    return [wholeDocumentEdit(document, finalText)]
  }

  protected format(node: AST.Node): void {
    const handler = Format[node.$type as FormattedNodeType]
    Assert.defined(handler, `a Tao format handler for AST node type '${node.$type}'`)
    // Handlers are keyed by `$type`, so the node is the handler's concrete node type.
    handler(createNodeFormat(node, this.getNodeFormatter(node)) as never)
  }
}

function wholeDocumentEdit(document: Langium.LangiumDocument, newText: string): Langium.TextEdit {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: document.textDocument.positionAt(document.textDocument.getText().length),
    },
    newText,
  }
}
