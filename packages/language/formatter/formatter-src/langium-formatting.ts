import { AST, Langium, Parser } from '@parser'
import { Assert } from '@shared'
import { type EmbeddedTsFormatter, ensureEmbeddedTsFormatter } from './embedded-ts'
import { Format } from './Format'
import { canonicalFunctionSource } from './formatters/AssociatedMethodsFormatter'
import { canonicalRenderPrefixSource } from './formatters/ViewsFormatter'
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
    const functions = document.parseResult.parserErrors.length === 0
      ? canonicalFunctionSource(document as AST.Document)
      : undefined
    if (functions !== undefined) {
      const parsed = await Parser.parseCode(functions, { validation: false, uri: document.uri })
      const migrated = parsed.entry.document
      Assert(migrated.parseResult.parserErrors.length === 0, 'function keyword migration preserves valid syntax')
      const migratedEdits = await new TaoFormatter().formatDocument(migrated, params)
      return [wholeDocumentEdit(document, applyTextEdits(migrated, migratedEdits))]
    }
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
    let prefixed = document.parseResult.parserErrors.length === 0
      ? canonicalRenderPrefixSource(document as AST.Document)
      : undefined
    if (prefixed !== undefined) {
      let parsed = await Parser.parseCode(prefixed, { validation: false, uri: document.uri })
      // Moving a tag can remove the token separating an ungrouped label value from a quotation.
      // Reparse proves the expression boundary; neither a newline nor name resolution can do so.
      const unsafe = parsed.entry.document.parseResult.parserErrors.length > 0
        ? AST.streamAllContents(document.parseResult.value).filter(AST.isRenderAccessibilityStatement)
        : changedRenderPrefixValues(document as AST.Document, parsed.entry.document)
      if (unsafe.length > 0) {
        prefixed = canonicalRenderPrefixSource(document as AST.Document, new Set(unsafe))
        if (prefixed === undefined) {
          return await this.formatNodes(document, params)
        }
        parsed = await Parser.parseCode(prefixed, { validation: false, uri: document.uri })
      }
      const canonical = parsed.entry.document
      Assert(canonical.parseResult.parserErrors.length === 0, 'render prefix normalization preserves valid syntax')
      Assert(
        changedRenderPrefixValues(document as AST.Document, canonical).length === 0,
        'render prefix normalization preserves label expression boundaries',
      )
      const canonicalEdits = await this.formatNodes(canonical, params)
      return [wholeDocumentEdit(document, applyTextEdits(canonical, canonicalEdits))]
    }
    return await this.formatNodes(document, params)
  }

  private async formatNodes(
    document: Langium.LangiumDocument,
    params: Langium.DocumentFormattingParams,
  ): Promise<Langium.TextEdit[]> {
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

function changedRenderPrefixValues(before: AST.Document, after: AST.Document): AST.RenderAccessibilityStatement[] {
  const labels = AST.streamAllContents(before.parseResult.value).filter(AST.isRenderAccessibilityStatement)
  const values = (document: AST.Document): string[] => {
    const source = document.textDocument.getText()
    return AST.streamAllContents(document.parseResult.value).filter(AST.isRenderAccessibilityStatement).map(label => {
      const range = AST.propertyRange(label, 'value')!
      return source.slice(range.from, range.to)
    })
  }
  const beforeValues = values(before)
  const afterValues = values(after)
  return beforeValues.length === afterValues.length
    ? labels.filter((_label, index) => beforeValues[index] !== afterValues[index])
    : labels
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
