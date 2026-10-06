import { AST } from '@parser'

/** canonicalInlineRendererSource removes redundant parentheses from simple renderer input names. */
export function canonicalInlineRendererSource(document: AST.Document): string | undefined {
  const source = document.textDocument.getText()
  const edits: { from: number; to: number; text: string }[] = []
  for (const use of AST.streamAllContents(document.parseResult.value).filter(AST.isRenderSlotUse)) {
    const firstBinding = use.inputBindings[0]
    const lastBinding = use.inputBindings.at(-1)
    if (!firstBinding || !lastBinding || !use.render) {
      continue
    }
    const first = AST.nodeRange(firstBinding)
    const last = AST.nodeRange(lastBinding)
    const slot = AST.propertyRange(use, 'slot')
    const body = AST.nodeRange(use.render)
    if (!first || !last || !slot || !body) {
      continue
    }
    const prefix = source.slice(slot.to, first.from)
    if (/^\s+$/.test(prefix)) {
      if (prefix !== ' ') {
        edits.push({ from: slot.to, to: first.from, text: ' ' })
      }
      continue
    }
    // Comments beside either parenthesis stay in place rather than being lost in a rewrite.
    if (
      !/^\s*\(\s*$/.test(prefix)
      || !/^\s*\)\s*->\s*$/.test(source.slice(last.to, body.from))
    ) {
      continue
    }
    edits.push({ from: slot.to, to: first.from, text: ' ' }, { from: last.to, to: body.from, text: ' -> ' })
  }
  if (edits.length === 0) {
    return undefined
  }
  return edits.sort((left, right) => right.from - left.from).reduce(
    (text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to),
    source,
  )
}
