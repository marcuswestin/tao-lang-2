import { AST } from '@parser'
import { assembleWithTrailingSource, sourceStatementContext } from './source-actions-utils'
import { sliceText, type StatementSlice } from './text-slices'
import { synthesizeImportSection } from './use-actions'

/**
 * canonicalizeTopLevel returns the document text with the canonical top-level statement order:
 * the synthesized import section (merged, deduplicated, sorted, unused imports dropped), then
 * project metadata, app declarations, and all other statements in their original relative order.
 * Future top-level kinds such as `theme` and `datasource` slot into the rank list when they exist.
 */
export function canonicalizeTopLevel(document: AST.Document): string {
  const context = sourceStatementContext(document)
  const { file, slices } = context
  const useSlices = slices.filter(isUseSlice)
  const ranked = slices
    .filter(slice => !isUseSlice(slice))
    .map((slice, index) => ({ slice, index }))
    .sort((a, b) => (statementRank(a.slice.statement) - statementRank(b.slice.statement)) || (a.index - b.index))

  return assembleWithTrailingSource(context, [
    { text: synthesizeImportSection(file, useSlices), blankBefore: false },
    ...ranked.map(entry => ({ text: sliceText(entry.slice), blankBefore: entry.slice.leading !== '' })),
  ])
}

function isUseSlice(slice: StatementSlice<AST.Statement>): slice is StatementSlice<AST.UseStatement> {
  return AST.isUseStatement(slice.statement)
}

const ProjectStatementRank = 0
const AppDeclarationRank = 1
const DefaultStatementRank = 2
function statementRank(statement: AST.Statement): number {
  return (
    AST.isProjectDeclaration(statement)
      ? ProjectStatementRank
      : AST.isAppDeclaration(statement)
      ? AppDeclarationRank
      : DefaultStatementRank
  )
}
