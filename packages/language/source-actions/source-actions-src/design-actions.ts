import { AST } from '@parser'
import {
  assemblePieces,
  closeBraceOffset,
  sliceText,
  type StatementSlice,
  statementSlices,
  type TextPiece,
  trimBlankLines,
} from './text-slices'

/** decidedVisualHeads maps each legacy visual clause head onto its decided spelling (Decisions §13). */
const decidedVisualHeads: Readonly<Record<string, string>> = { bg: 'background', fg: 'ink' }

/** TextEdit replaces the source between two offsets. */
type TextEdit = { start: number; end: number; text: string }

/**
 * renameLegacyVisualHeads returns the document text with every `bg` and `fg` clause head spelled
 * `background` and `ink`, or undefined when there is none. A clause list that already spells one
 * property both ways is an error the author resolves, so that list is left exactly as written.
 */
export function renameLegacyVisualHeads(document: AST.Document): string | undefined {
  const edits = AST.streamAllContents(document.parseResult.value)
    .filter(AST.isLayoutClause)
    .flatMap(legacyHeadEdits)
  return edits.length === 0 ? undefined : applyEdits(document.textDocument.getText(), edits)
}

/**
 * moveFlatCatalogIntoBlocks returns the document text with each design's flat colors moved into its
 * `colors { }` block and its flat styles into its `styles { }` block, or undefined when no design has
 * a flat member. Moved members append to an existing block in source order, carrying their leading
 * comment lines; a design without the block gets one where its first flat member of that kind stood.
 */
export function moveFlatCatalogIntoBlocks(document: AST.Document): string | undefined {
  const text = document.textDocument.getText()
  const edits = AST.streamAllContents(document.parseResult.value)
    .filter(AST.isDesignDeclaration)
    .flatMap(design => flatCatalogEdit(text, design))
  return edits.length === 0 ? undefined : applyEdits(text, edits)
}

function legacyHeadEdits(clause: AST.LayoutClause): TextEdit[] {
  const heads = clause.entries.map(entry => entry.head)
  const spelledHeads = new Set(heads.map(plainWord))
  const spellsPropertyBothWays = Object.entries(decidedVisualHeads)
    .some(([legacy, decided]) => spelledHeads.has(legacy) && spelledHeads.has(decided))
  if (spellsPropertyBothWays) {
    return []
  }
  return heads.flatMap(head => {
    const decided = decidedVisualHeads[plainWord(head) ?? '']
    return decided === undefined ? [] : [{ start: head.$cstNode!.offset, end: head.$cstNode!.end, text: decided }]
  })
}

/** plainWord returns a clause term's word when it is a bare word, without suffixes or a path. */
function plainWord(term: AST.LayoutTerm): string | undefined {
  return AST.isLayoutWord(term) && term.suffixes.length === 0 && term.pathSegments.length === 0
    ? term.value
    : undefined
}

/** FlatCatalogBlock names one typed block a flat member kind moves into. */
type FlatCatalogBlock = {
  keyword: string
  isFlatMember: (member: AST.DesignMember) => boolean
  isBlock: (member: AST.DesignMember) => boolean
}

const flatCatalogBlocks: readonly FlatCatalogBlock[] = [
  { keyword: 'colors', isFlatMember: AST.isDesignToken, isBlock: AST.isDesignColorsBlock },
  { keyword: 'styles', isFlatMember: AST.isDesignBundle, isBlock: AST.isDesignStylesBlock },
]

function flatCatalogEdit(text: string, design: AST.DesignDeclaration): TextEdit[] {
  const members = design.block.members
  if (!members.some(isFlatMember)) {
    return []
  }
  const bodyStart = design.block.$cstNode!.offset + 1
  const bodyEnd = closeBraceOffset(text, design.block)
  const { slices, end } = statementSlices(text, members, bodyStart, bodyEnd)
  // Each block kind lands at its existing block, or else at its first flat member.
  const landings = new Map<AST.DesignMember, TextPiece>()
  for (const block of flatCatalogBlocks) {
    const moved = slices.filter(slice => block.isFlatMember(slice.statement))
    const existing = slices.find(slice => block.isBlock(slice.statement))
    if (moved.length === 0) {
      continue
    }
    const entries = assemblePieces(moved.map(commentLedPiece))
    const commentLed = moved[0]!.leading !== ''
    landings.set(
      (existing ?? moved[0]!).statement,
      existing === undefined
        ? { text: `${block.keyword} {\n${entries}\n}`, blankBefore: commentLed }
        : {
          ...commentLedPiece(existing),
          text: appendToBlock(text, existing, { text: entries, blankBefore: commentLed }),
        },
    )
  }
  const pieces = slices.flatMap(slice =>
    landings.has(slice.statement)
      ? [landings.get(slice.statement)!]
      : isFlatMember(slice.statement)
      ? []
      : [commentLedPiece(slice)]
  )
  const trailing = trimBlankLines(text.slice(end, bodyEnd))
  return [{
    start: bodyStart,
    end: bodyEnd,
    text: `\n${assemblePieces([...pieces, { text: trailing, blankBefore: false }])}\n`,
  }]
}

function isFlatMember(member: AST.DesignMember): boolean {
  return flatCatalogBlocks.some(block => block.isFlatMember(member))
}

/** commentLedPiece returns a slice's text, keeping a blank line above it when comments lead it. */
function commentLedPiece(slice: StatementSlice<AST.DesignMember>): TextPiece {
  return { text: sliceText(slice), blankBefore: slice.leading !== '' }
}

/**
 * appendToBlock returns an existing typed block's slice text with `entries` added before its closing
 * brace, keeping a blank line above comment-led entries when the block already holds something.
 */
function appendToBlock(text: string, block: StatementSlice<AST.DesignMember>, entries: TextPiece): string {
  const blockText = sliceText(block)
  const closeInText = closeBraceOffset(text, block.statement) - block.statement.$cstNode!.offset
  const closeInBlock = blockText.length - block.body.length + closeInText
  const opening = blockText.slice(0, closeInBlock).trimEnd()
  const separator = entries.blankBefore && !opening.endsWith('{') ? '\n\n' : '\n'
  return `${opening}${separator}${entries.text}\n${blockText.slice(closeInBlock)}`
}

/** applyEdits applies non-overlapping edits to `text`. */
function applyEdits(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((current, edit) => current.slice(0, edit.start) + edit.text + current.slice(edit.end), text)
}
