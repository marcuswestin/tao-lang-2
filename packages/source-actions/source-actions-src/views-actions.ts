import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { sliceText, statementSlices } from './text-slices'

/**
 * moveViewRendersLast returns the text as document with each view body's single render statement
 * moved to the end, or undefined when nothing needs to move. Views with zero or multiple render
 * statements are left for the validator to report.
 */
export function moveViewRendersLast(document: AST.Document): string | undefined {
  const file = document.parseResult.value
  const viewsToReorder = ASTUtils.streamAllContents(file)
    .filter(AST.isRenderableDeclaration)
    .filter(needsRenderMove)
    .sort((a, b) => b.block.statements[0]!.$cstNode!.offset - a.block.statements[0]!.$cstNode!.offset)
  if (viewsToReorder.length === 0) {
    return undefined
  }

  let text = document.textDocument.getText()
  for (const view of viewsToReorder) {
    const statements = view.block.statements
    const regionStart = statementRegionStart(text, view.block, statements[0]!.$cstNode!.offset)
    const { slices, end } = statementSlices(text, statements, regionStart, blockCloseBraceOffset(text, view.block))
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

function blockCloseBraceOffset(text: string, block: AST.Block): number {
  const blockEnd = block.$cstNode!.end
  const closeOffset = text.lastIndexOf('}', blockEnd - 1)
  return closeOffset === -1 ? blockEnd : closeOffset
}

function needsRenderMove(view: AST.RenderableDeclaration): boolean {
  const statements = view.block.statements
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  return statements.filter(AST.isRenderStatement).length === 1
    && renderIndex !== statements.length - 1
}
