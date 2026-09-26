import { AST, Langium, Parser } from '@parser'
import { Assert } from '@shared'
import { type EmbeddedTsFormatter, ensureEmbeddedTsFormatter } from './embedded-ts'
import { Format } from './Format'
import {
  applyTextEdits,
  createNodeFormat,
  finishFormattedText,
  type FormattedNodeType,
  taoTabSize,
} from './formatting'
import { assignedQuerySource } from './query-syntax'

/** TaoFormatter formats Tao documents by dispatching per-node Format handlers. */
export class TaoFormatter extends Langium.AbstractFormatter {
  /**
   * formatDocument chains Langium edits with the Tao text post-passes so every host formats
   * identically. The host's requested tab size is ignored: Tao is always indented with `taoTabSize`.
   */
  override async formatDocument(
    document: Langium.LangiumDocument,
    params: Langium.DocumentFormattingParams,
  ): Promise<Langium.TextEdit[]> {
    const assigned = document.parseResult.parserErrors.length === 0
      ? assignedQuerySource(document as AST.Document)
      : undefined
    if (assigned !== undefined) {
      const parsed = await Parser.parseCode(assigned, { validation: false, uri: document.uri })
      const migrated = parsed.entry.document
      Assert(migrated.parseResult.parserErrors.length === 0, 'assigned query migration preserves valid syntax')
      const migratedEdits = await new TaoFormatter().formatDocument(migrated, params)
      return [wholeDocumentEdit(document, applyTextEdits(migrated, migratedEdits))]
    }
    const taoParams = { ...params, options: { ...params.options, tabSize: taoTabSize, insertSpaces: true } }
    const edits = await super.formatDocument(document, taoParams)
    const formatted = applyTextEdits(document as AST.Document, edits)
    const tab = ' '.repeat(taoTabSize)
    const embeddedTsFormatter = await tryEnsureEmbeddedTsFormatter()
    const finalText = finishFormattedText(formatted, tab, embeddedTsFormatter)
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

async function tryEnsureEmbeddedTsFormatter(): Promise<EmbeddedTsFormatter | undefined> {
  try {
    return await ensureEmbeddedTsFormatter()
  } catch {
    return undefined
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
