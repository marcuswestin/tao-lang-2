import { AST } from '@parser'
import { assemblePieces, sliceText, type StatementSlice, statementSlices, trimBlankLines } from './text-slices'
import { synthesizeImportSection } from './use-actions'

/**
 * canonicalizeTopLevel returns the document text with the canonical top-level statement order:
 * the synthesized import section (merged, deduplicated, sorted, unused imports dropped), then
 * app declarations, then all other statements in their original relative order. Future top-level
 * kinds such as `project`, `theme`, and `datasource` slot into the rank list when they exist.
 */
export function canonicalizeTopLevel(document: AST.Document): string {
  const text = document.textDocument.getText()
  const file = document.parseResult.value
  const { slices, end } = statementSlices(text, file.statements)
  const useSlices = slices.filter(isUseSlice)
  const ranked = slices
    .filter(slice => !isUseSlice(slice))
    .map((slice, index) => ({ slice, index }))
    .sort((a, b) => (statementRank(a.slice.statement) - statementRank(b.slice.statement)) || (a.index - b.index))

  const pieces = [
    { text: synthesizeImportSection(file, useSlices), blankBefore: false },
    ...ranked.map(entry => ({ text: sliceText(entry.slice), blankBefore: entry.slice.leading !== '' })),
    { text: trimBlankLines(text.slice(end)), blankBefore: true },
  ]
  return assemblePieces(pieces)
}

function isUseSlice(slice: StatementSlice<AST.Statement>): slice is StatementSlice<AST.UseStatement> {
  return AST.isUseStatement(slice.statement)
}

function statementRank(statement: AST.Statement): number {
  return AST.isAppDeclaration(statement) ? 0 : 1
}
