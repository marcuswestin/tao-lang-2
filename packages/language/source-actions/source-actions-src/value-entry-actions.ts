import { AST } from '@parser'
import { applySourceEdits, type SourceEdit } from './studio/studio-source-text'

/** insertValueEntryCommas separates adjacent item and configuration values without changing declarations. */
export function insertValueEntryCommas(document: AST.Document): string | undefined {
  const source = document.textDocument.getText()
  const nodes = AST.streamAllContents(document.parseResult.value)
  const edits: SourceEdit[] = []
  for (const item of nodes.filter(AST.isItemLiteral)) {
    edits.push(...missingEntryCommas(source, item, item.properties))
  }
  for (const block of nodes.filter(AST.isConfigurationBlock)) {
    edits.push(...missingEntryCommas(
      source,
      block,
      block.entries.map(entry => isValueEntry(entry) ? entry : undefined),
    ))
  }
  return edits.length === 0 ? undefined : applySourceEdits(source, edits)
}

/** Configuration directives break a value run and keep their declaration punctuation. */
function isValueEntry(entry: AST.ConfigurationEntry): boolean {
  return entry.restoration === undefined && entry.rootView === undefined
    && entry.requirement === undefined && entry.appGuard === undefined
}

function missingEntryCommas(
  source: string,
  block: AST.Node,
  entries: readonly (AST.Node | undefined)[],
): SourceEdit[] {
  const comments = AST.commentRanges(block)
  const edits: SourceEdit[] = []
  for (let index = 0; index < entries.length - 1; index += 1) {
    const entry = entries[index]
    const next = entries[index + 1]
    if (entry === undefined || next === undefined) {
      continue
    }
    const end = AST.nodeRange(entry)!.to
    const nextStart = AST.nodeRange(next)!.from
    let hasComma = false
    for (let offset = end; offset < nextStart; offset += 1) {
      if (source[offset] === ',' && !comments.some(comment => offset >= comment.from && offset < comment.to)) {
        hasComma = true
        break
      }
    }
    if (!hasComma) {
      edits.push({ end, replacement: ',', start: end })
    }
  }
  return edits
}
