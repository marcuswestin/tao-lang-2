import { AST } from '@parser'

/** assignedQuerySource migrates query heads by token range, preserving every comment and clause. */
export function assignedQuerySource(document: AST.Document): string | undefined {
  const edits: { range: AST.SyntaxRange; text: string }[] = []
  for (const query of AST.streamAllContents(document.parseResult.value).filter(AST.isEntityQueryDeclaration)) {
    if (AST.keywordRange(query, '=')) {
      continue
    }
    const name = AST.propertyRange(query, 'name')
    if (!name) {
      continue
    }
    const from = AST.keywordRange(query, 'from')
    const as = AST.keywordRange(query, 'as')
    const sourceName = AST.propertyRange(query, 'sourceName')
    if (as && sourceName) {
      edits.push(
        { range: sourceName, text: query.name },
        { range: as, text: '=' },
        { range: name, text: query.sourceName! },
      )
    } else if (from) {
      edits.push({ range: from, text: '=' })
    } else {
      edits.push({ range: { from: name.to, to: name.to }, text: ` = ${query.name}` })
    }
    if (query.block) {
      const block = AST.nodeRange(query.block)!
      edits.push({ range: { from: block.from, to: block.from }, text: ' with ' })
    }
  }
  if (edits.length === 0) {
    return undefined
  }
  // Adjacent tokens can put both head and block insertions at the same offset. Combine them in
  // authored order before applying from the end, so neither insertion reverses the other.
  const combined = new Map<string, { range: AST.SyntaxRange; text: string }>()
  for (const edit of edits) {
    const key = `${edit.range.from}:${edit.range.to}`
    const previous = combined.get(key)
    combined.set(key, previous ? { range: edit.range, text: previous.text + edit.text } : edit)
  }
  return [...combined.values()].sort((left, right) => right.range.from - left.range.from)
    .reduce(
      (text, edit) => text.slice(0, edit.range.from) + edit.text + text.slice(edit.range.to),
      document.textDocument.getText(),
    )
}
