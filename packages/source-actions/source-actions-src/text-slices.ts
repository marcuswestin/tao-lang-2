import type { AST } from '@parser'

/** StatementSlice declares one statement's source text, including the comment lines leading it. */
export type StatementSlice<StatementT extends AST.Node = AST.Node> = {
  statement: StatementT
  /** leading holds comment lines between the previous statement and this one. */
  leading: string
  /** body holds the statement source from its first to its last token, extended to the line end. */
  body: string
}

/**
 * statementSlices splits `text` into per-statement slices over `statements`, starting at
 * `regionStart`, and returns the offset where the last slice ended. Comment lines between
 * statements ride along as the following statement's `leading`.
 */
export function statementSlices<StatementT extends AST.Node>(
  text: string,
  statements: readonly StatementT[],
  regionStart = 0,
): { slices: StatementSlice<StatementT>[]; end: number } {
  const slices: StatementSlice<StatementT>[] = []
  let sliceStart = regionStart
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]!
    const cstNode = statement.$cstNode!
    const nextStart = statements[index + 1]?.$cstNode!.offset
    const bodyEnd = nextStart === undefined
      ? endOfLine(text, cstNode.end)
      : Math.min(endOfLine(text, cstNode.end), nextStart)
    slices.push({
      statement,
      leading: trimBlankLines(text.slice(sliceStart, cstNode.offset)),
      body: text.slice(cstNode.offset, bodyEnd).trimEnd(),
    })
    sliceStart = bodyEnd
  }
  return { slices, end: sliceStart }
}

/** sliceText returns a slice's source text with its leading comments. */
export function sliceText(slice: StatementSlice): string {
  return slice.leading === '' ? slice.body : `${slice.leading}\n${slice.body}`
}

/** TextPiece declares one reassembled source chunk and whether a blank line belongs above it. */
export type TextPiece = {
  text: string
  /** blankBefore keeps a blank line above comment-led pieces; the formatter preserves it. */
  blankBefore: boolean
}

/** assemblePieces joins reassembled source pieces, leaving a blank line above comment-led pieces. */
export function assemblePieces(pieces: readonly TextPiece[]): string {
  return pieces
    .filter(piece => piece.text !== '')
    .map((piece, index) => index === 0 ? piece.text : `${piece.blankBefore ? '\n\n' : '\n'}${piece.text}`)
    .join('')
}

/** trimBlankLines drops blank lines and trailing line whitespace from a text chunk. */
export function trimBlankLines(text: string): string {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
    .join('\n')
}

function endOfLine(text: string, offset: number): number {
  const newlineIndex = text.indexOf('\n', offset)
  return newlineIndex === -1 ? text.length : newlineIndex
}
