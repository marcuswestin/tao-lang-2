import { AST, Langium } from '@parser'

/** taoTabSize declares the canonical Tao indentation width in spaces; Tao formatting is not configurable. */
export const taoTabSize = 3

/** LineSeparation declares an exact newline count, or an inclusive range fitted to the existing newlines. */
export type LineSeparation = number | { min: number; max: number }

/** NodeFormat exposes succinct formatting verbs scoped to one AST node. */
export type NodeFormat<NodeT extends AST.Node> = {
  /** node holds the AST node being formatted. */
  readonly node: NodeT
  /** oneSpaceBefore requests exactly one space before each present keyword. */
  oneSpaceBefore(...keywords: string[]): void
  /** oneSpaceAfter requests exactly one space after each present keyword. */
  oneSpaceAfter(...keywords: string[]): void
  /** oneSpaceAround requests exactly one space on both sides of each present keyword. */
  oneSpaceAround(...keywords: string[]): void
  /** noSpaceAfter requests no space after each present keyword. */
  noSpaceAfter(...keywords: string[]): void
  /** noSpaceBefore requests no space before each present keyword. */
  noSpaceBefore(...keywords: string[]): void
  /** parenthesizedArguments formats an invocation's `(` and `)` tight against the name and arguments. */
  parenthesizedArguments(): void
  /** oneSpaceBeforeProperty requests exactly one space before each present property value. */
  oneSpaceBeforeProperty(...properties: Langium.Properties<NodeT>[]): void
  /** oneSpaceBetweenProperties requests exactly one space before the second property when both are present. */
  oneSpaceBetweenProperties(left: Langium.Properties<NodeT>, right: Langium.Properties<NodeT>): void
  /** commaSpacedList formats list commas with no space before and one space after. */
  commaSpacedList(): void
  /** commaLineList formats block-list commas without adding a space before the line break. */
  commaLineList(): void
  /** spaceSeparatedList formats adjacent nodes with one space between them. */
  spaceSeparatedList(items: readonly AST.Node[]): void
  /** lineSeparatedList formats adjacent nodes with one newline between them. */
  lineSeparatedList(items: readonly AST.Node[]): void
  /** indentedLines starts each listed node on its own line, one indent below the current node. */
  indentedLines(items: readonly AST.Node[]): void
  /** indentedLine starts each present keyword on its own line, one indent below the current node. */
  indentedLine(...keywords: string[]): void
  /** indentedBraceBlock formats braces as `{ }` when empty, or one indented item per line with `}` on its own line. */
  indentedBraceBlock(items: readonly AST.Node[]): void
  /** singleLineBraceBlock formats a one-statement brace block as `{ statement }`. */
  singleLineBraceBlock(item: AST.Node): void
  /** indentedBracketBlock formats list brackets with one indented item per line when non-empty. */
  indentedBracketBlock(items: readonly AST.Node[]): void
  /** separateLines puts each item after the first on its own line, `linesBetween` newlines below the previous item. */
  separateLines<ItemT extends AST.Node>(
    items: readonly ItemT[],
    linesBetween: (previous: ItemT, next: ItemT) => LineSeparation,
  ): void
  /** separateIndentedLines is separateLines for brace-block children one indent below the current node. */
  separateIndentedLines<ItemT extends AST.Node>(
    items: readonly ItemT[],
    linesBetween: (previous: ItemT, next: ItemT) => LineSeparation,
  ): void
}

// Concrete node types are the map entries whose `$type` equals their key; union aliases such as
// `Statement` carry the union of their members' `$type`s and never appear as a node's `$type`.
type ConcreteNodeType = {
  [TypeT in keyof AST.TaoLangAstType]: AST.TaoLangAstType[TypeT] extends { $type: TypeT } ? TypeT : never
}[keyof AST.TaoLangAstType]

/**
 * FormattedNodeType declares every AST node type the formatter must handle: all concrete node
 * types except per-grammar-file entrypoint wrappers, which never occur in parsed Tao files.
 */
export type FormattedNodeType = Exclude<ConcreteNodeType, `${string}GrammarEntrypoint`>

/** FormatHandlers declares one formatting function for every formatted AST node type. */
export type FormatHandlers = {
  [TypeT in FormattedNodeType]: (f: NodeFormat<AST.TaoLangAstType[TypeT]>) => void
}

/** createNodeFormat wraps a Langium node formatter in the Tao formatting verbs. */
export function createNodeFormat<NodeT extends AST.Node>(
  node: NodeT,
  formatter: Langium.NodeFormatter<NodeT>,
): NodeFormat<NodeT> {
  const Formatting = Langium.Formatting
  return {
    node,
    oneSpaceBefore(...keywords) {
      formatter.keywords(...keywords).prepend(Formatting.oneSpace())
    },
    oneSpaceAfter(...keywords) {
      formatter.keywords(...keywords).append(Formatting.oneSpace())
    },
    oneSpaceAround(...keywords) {
      formatter.keywords(...keywords).surround(Formatting.oneSpace())
    },
    noSpaceAfter(...keywords) {
      formatter.keywords(...keywords).append(Formatting.noSpace())
    },
    noSpaceBefore(...keywords) {
      formatter.keywords(...keywords).prepend(Formatting.noSpace())
    },
    parenthesizedArguments() {
      formatter.keyword('(').prepend(Formatting.noSpace()).append(Formatting.noSpace())
      formatter.keyword(')').prepend(Formatting.noSpace())
    },
    oneSpaceBeforeProperty(...properties) {
      formatter.properties(...properties).prepend(Formatting.oneSpace())
    },
    oneSpaceBetweenProperties(left, right) {
      const properties = node as Record<string, unknown>
      if (properties[left] !== undefined && properties[right] !== undefined) {
        formatter.property(right).prepend(Formatting.oneSpace())
      }
    },
    commaSpacedList() {
      formatter.keywords(',').prepend(Formatting.noSpace()).append(Formatting.oneSpace())
    },
    commaLineList() {
      formatter.keywords(',').prepend(Formatting.noSpace()).append(Formatting.noSpace())
    },
    spaceSeparatedList(items) {
      for (const item of items.slice(1)) {
        formatter.node(item).prepend(Formatting.oneSpace())
      }
    },
    lineSeparatedList(items) {
      for (const item of items.slice(1)) {
        formatter.node(item).prepend(Formatting.indent())
      }
    },
    indentedLines(items) {
      for (const item of items) {
        formatter.node(item).prepend(Formatting.indent())
      }
    },
    indentedLine(...keywords) {
      formatter.keywords(...keywords).prepend(Formatting.indent())
    },
    indentedBraceBlock(items) {
      const open = formatter.keyword('{')
      const close = formatter.keyword('}')
      if (items.length === 0) {
        open.append(Formatting.oneSpace())
      } else {
        formatter.interior(open, close).prepend(Formatting.indent())
        close.prepend(Formatting.newLine())
      }
    },
    singleLineBraceBlock() {
      const open = formatter.keyword('{')
      const close = formatter.keyword('}')
      open.append(Formatting.oneSpace())
      close.prepend(Formatting.oneSpace())
    },
    indentedBracketBlock(items) {
      if (items.length === 0) {
        return
      }
      const open = formatter.keyword('[')
      const close = formatter.keyword(']')
      formatter.interior(open, close).prepend(Formatting.indent())
      close.prepend(Formatting.newLine())
    },
    separateLines(items, linesBetween) {
      separateLines(formatter, items, linesBetween, 0)
    },
    separateIndentedLines(items, linesBetween) {
      separateLines(formatter, items, linesBetween, 1)
    },
  }
}

function separateLines<ItemT extends AST.Node>(
  formatter: Langium.NodeFormatter<AST.Node>,
  items: readonly ItemT[],
  linesBetween: (previous: ItemT, next: ItemT) => LineSeparation,
  tabs: number,
): void {
  if (items.length < 2) {
    return
  }
  const leaves = Langium.CstUtils.flattenCst(items[0]!.$cstNode!.root).toArray()
  for (let index = 1; index < items.length; index++) {
    const previous = items[index - 1]!
    const next = items[index]!
    const separation = newLinesAction(linesBetween(previous, next), tabs)
    // The separation goes above the item's leading comments so they stay attached below it.
    const comments = leadingCommentLeaves(next, leaves)
    if (comments.length === 0) {
      formatter.node(next).prepend(separation)
      continue
    }
    formatter.cst([comments[0]!]).prepend(separation)
    formatter.cst(comments.slice(1)).prepend(newLinesAction(1, tabs))
    formatter.node(next).prepend(newLinesAction(1, tabs))
  }
}

// A leading comment owns its line; a comment trailing earlier source on the same line stays there.
function leadingCommentLeaves(item: AST.Node, leaves: readonly Langium.CstNode[]): Langium.CstNode[] {
  const itemOffset = item.$cstNode!.offset
  let index = leaves.findIndex(leaf => leaf.offset === itemOffset)
  const comments: Langium.CstNode[] = []
  while (index > 0) {
    const candidate = leaves[index - 1]!
    if (!candidate.hidden) {
      break
    }
    const beforeCandidate = leaves[index - 2]
    if (beforeCandidate && beforeCandidate.range.end.line === candidate.range.start.line) {
      break
    }
    comments.unshift(candidate)
    index--
  }
  return comments
}

// A min/max range fits the existing newline count when it is within the range and clamps it otherwise.
function newLinesAction(separation: LineSeparation, tabs = 0): Langium.FormattingAction {
  if (typeof separation === 'number') {
    return newLinesWithTabs(separation, tabs)
  }
  const counts = Array.from({ length: separation.max - separation.min + 1 }, (_, step) => separation.min + step)
  return Langium.Formatting.fit(...counts.map(count => newLinesWithTabs(count, tabs)))
}

function newLinesWithTabs(lines: number, tabs: number): Langium.FormattingAction {
  return tabs === 0 ? Langium.Formatting.newLines(lines) : { options: {}, moves: [{ lines, tabs }] }
}

/** isInjectionFenceOpenLine returns true when a line opens a multiline inject TS fence. */
export function isInjectionFenceOpenLine(line: string): boolean {
  // Anchored to the `inject`/`render inject` statement start so comment lines never match.
  // Trailing whitespace after the opener is part of the fence token and only trimmed at finalization.
  return /^[ \t]*(render\b[ \t]+)?inject\b.*```ts[ \t]*$/.test(line)
}

/** findInjectionFenceCloseIndex returns the index of the line closing the fence opened above `openIndex`, or -1. */
export function findInjectionFenceCloseIndex(lines: readonly string[], openIndex: number): number {
  return lines.findIndex((line, index) => index > openIndex && line.includes('```'))
}

/**
 * finalizeFormattedText drops leading whitespace and trailing line spaces outside inject fence
 * bodies, and ends the text with exactly one newline. Fence body lines keep their trailing
 * whitespace because they are user TypeScript.
 */
export function finalizeFormattedText(text: string): string {
  const lines = text.replace(/^\s+/, '').split('\n')
  const result: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (isInjectionFenceOpenLine(line)) {
      const closeIndex = findInjectionFenceCloseIndex(lines, index)
      const fenceEnd = closeIndex === -1 ? lines.length - 1 : closeIndex
      result.push(line.replace(/[ \t]+$/, ''))
      result.push(...lines.slice(index + 1, fenceEnd + 1))
      index = fenceEnd + 1
      continue
    }
    result.push(line.replace(/[ \t]+$/, ''))
    index++
  }
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop()
  }
  return `${result.join('\n')}\n`
}

/** applyTextEdits applies non-overlapping LSP text edits to the document's source text. */
export function applyTextEdits(document: AST.Document, edits: readonly Langium.TextEdit[]): string {
  const textDocument = document.textDocument
  const sorted = [...edits].sort(
    (a, b) => textDocument.offsetAt(b.range.start) - textDocument.offsetAt(a.range.start),
  )
  let text = textDocument.getText()
  for (const edit of sorted) {
    const start = textDocument.offsetAt(edit.range.start)
    const end = textDocument.offsetAt(edit.range.end)
    text = text.slice(0, start) + edit.newText + text.slice(end)
  }
  return text
}
