import { AST } from '@parser'
import { closeBraceOffset, sliceText, statementSlices } from './text-slices'

/**
 * moveViewRendersLast returns the document text with each visual declaration's single render
 * statement moved to the end, or undefined when nothing needs to move. Declarations with zero or
 * multiple render statements are left for the validator to report.
 */
export function moveViewRendersLast(document: AST.Document): string | undefined {
  const file = document.parseResult.value
  const viewsToReorder = AST.streamAllContents(file)
    .filter(AST.isViewDeclaration)
    .filter(needsRenderMove)
    .sort((a, b) => AST.blockStatementOf(b, 0).$cstNode!.offset - AST.blockStatementOf(a, 0).$cstNode!.offset)
  if (viewsToReorder.length === 0) {
    return undefined
  }

  let text = document.textDocument.getText()
  for (const view of viewsToReorder) {
    const block = view.block
    if (!block) {
      continue
    }
    const statements = AST.blockStatements(view)
    const regionStart = statementRegionStart(text, block, statements[0]!.$cstNode!.offset)
    const { slices, end } = statementSlices(text, statements, regionStart, closeBraceOffset(text, block))
    const renderSlices = slices.filter(slice => AST.isRenderStatement(slice.statement))
    const otherSlices = slices.filter(slice => !AST.isRenderStatement(slice.statement))
    const reordered = [...otherSlices, ...renderSlices].map(sliceText).join('\n')
    text = text.slice(0, regionStart) + reordered + text.slice(end)
  }
  return text
}

function statementRegionStart(text: string, block: AST.Block, firstStatementOffset: number): number {
  const openOffset = text.indexOf('{', block.$cstNode!.offset)
  const bodyStart = openOffset === -1 || openOffset > firstStatementOffset ? block.$cstNode!.offset : openOffset + 1
  const leading = text.slice(bodyStart, firstStatementOffset)
  const comment = /(?:^|\n)[ \t]*(?:\/\/|\/\*)/.exec(leading)
  if (!comment) {
    return firstStatementOffset
  }
  return bodyStart + comment.index + (leading[comment.index] === '\n' ? 1 : 0)
}

function needsRenderMove(view: AST.ViewDeclaration): boolean {
  const statements = AST.blockStatements(view)
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  return statements.filter(AST.isRenderStatement).length === 1
    && renderIndex !== statements.length - 1
}
