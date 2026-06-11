import { AST, Langium } from '@parser'

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
    linesBetween: (previous: ItemT, next: ItemT) => number,
  ): void
}

/** FormatHandlers declares optional per-node-type formatting functions keyed by AST node type. */
export type FormatHandlers = {
  [TypeT in keyof AST.TaoLangAstType]?: AST.TaoLangAstType[TypeT] extends AST.Node
    ? (f: NodeFormat<AST.TaoLangAstType[TypeT]>) => void
    : never
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
        formatter.node(next).prepend(Langium.Formatting.newLines(linesBetween(previous, next)))
      }
    },
  }
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
