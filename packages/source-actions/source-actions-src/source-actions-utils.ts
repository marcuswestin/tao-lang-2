import Formatter from '@formatter'
import { type AST, Parser } from '@parser'
import { Assert } from '@shared'
import { assemblePieces, type StatementSlice, statementSlices, type TextPiece, trimBlankLines } from './text-slices'

/** SourceActionOptions configures source-action reparsing behavior. */
export type SourceActionOptions = {
  parseUpdatedDocument?: (document: AST.Document, text: string) => Promise<AST.Document>
}

/** SourceStatementContext declares a source document plus its top-level statement slices. */
type SourceStatementContext = {
  document: AST.Document
  file: AST.TaoFile
  text: string
  slices: StatementSlice<AST.Statement>[]
  end: number
}

/** sourceStatementContext returns reusable top-level slicing data for a Tao document. */
export function sourceStatementContext(document: AST.Document): SourceStatementContext {
  const text = document.textDocument.getText()
  const file = document.parseResult.value
  const { slices, end } = statementSlices(text, file.statements)
  return { document, file, text, slices, end }
}

/** assembleWithTrailingSource joins pieces and keeps trailing non-statement source text. */
export function assembleWithTrailingSource(context: SourceStatementContext, pieces: readonly TextPiece[]): string {
  return assemblePieces([
    ...pieces,
    {
      text: trimBlankLines(context.text.slice(context.end)),
      blankBefore: true,
    },
  ])
}

/** formatWhenChanged formats text and returns undefined if it already matches the document. */
export async function formatWhenChanged(document: AST.Document, text: string): Promise<string | undefined> {
  const formatted = await Formatter.formatCode(text)
  return formatted === document.textDocument.getText() ? undefined : formatted
}

/** parseSourceText parses updated Tao source, preserving the original document URI. */
export async function parseSourceText(
  document: AST.Document,
  text: string,
  options: SourceActionOptions = {},
): Promise<AST.Document> {
  if (options.parseUpdatedDocument) {
    return await options.parseUpdatedDocument(document, text)
  }
  return (await Parser.parseCode(text, { uri: document.uri, validation: false })).entry.document
}

/** hasSyntaxErrors returns whether a document has lexer or parser errors. */
export function hasSyntaxErrors(document: AST.Document): boolean {
  return firstSyntaxError(document) !== undefined
}

/** assertNoSyntaxErrors rejects source-action transforms on syntactically invalid Tao. */
export function assertNoSyntaxErrors(document: AST.Document): void {
  Assert(!hasSyntaxErrors(document), 'Tao source without syntax errors when applying source fixes', {
    firstError: firstSyntaxError(document),
  })
}

/** firstSyntaxError returns the first lexer or parser error message, if any. */
export function firstSyntaxError(document: AST.Document): string | undefined {
  return document.parseResult.lexerErrors[0]?.message ?? document.parseResult.parserErrors[0]?.message
}
