import { AST, Langium } from '@parser'

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
  /** oneSpaceBeforeProperty requests exactly one space before each present property value. */
  oneSpaceBeforeProperty(...properties: Langium.Properties<NodeT>[]): void
  /** commaSpacedList formats list commas with no space before and one space after. */
  commaSpacedList(): void
  /** indentedBraceBlock formats braces as `{ }` when empty, or one indented item per line with `}` on its own line. */
  indentedBraceBlock(items: readonly AST.Node[]): void
  /** separateLines puts each item after the first on its own line, `linesBetween` newlines below the previous item. */
  separateLines<ItemT extends AST.Node>(
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
    oneSpaceBeforeProperty(...properties) {
      formatter.properties(...properties).prepend(Formatting.oneSpace())
    },
    commaSpacedList() {
      formatter.keywords(',').prepend(Formatting.noSpace()).append(Formatting.oneSpace())
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
    separateLines(items, linesBetween) {
      for (let index = 1; index < items.length; index++) {
        const previous = items[index - 1]!
        const next = items[index]!
        formatter.node(next).prepend(newLinesAction(linesBetween(previous, next)))
      }
    },
  }
}

// A min/max range fits the existing newline count when it is within the range and clamps it otherwise.
function newLinesAction(separation: LineSeparation): Langium.FormattingAction {
  if (typeof separation === 'number') {
    return Langium.Formatting.newLines(separation)
  }
  const counts = Array.from({ length: separation.max - separation.min + 1 }, (_, step) => separation.min + step)
  return Langium.Formatting.fit(...counts.map(count => Langium.Formatting.newLines(count)))
}

/** isInjectionFenceOpenLine returns true when a line opens a multiline inject TS fence. */
export function isInjectionFenceOpenLine(line: string): boolean {
  return /^[ \t]*.*\binject\b.*```ts$/.test(line)
}

/** findInjectionFenceCloseIndex returns the index of the line closing the fence opened above `openIndex`, or -1. */
export function findInjectionFenceCloseIndex(lines: readonly string[], openIndex: number): number {
  return lines.findIndex((line, index) => index > openIndex && line.includes('```'))
}

/** finalizeFormattedText drops leading whitespace and trailing line spaces, and ends with exactly one newline. */
export function finalizeFormattedText(text: string): string {
  return `${text.replace(/^\s+/, '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '')}\n`
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
