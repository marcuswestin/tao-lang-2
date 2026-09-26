import { AST } from '@parser'

/** migrateRelationTraits moves an unambiguous legacy relation target into the field's type position. */
export function migrateRelationTraits(document: AST.Document): string | undefined {
  const text = document.textDocument.getText()
  const edits: { range: AST.SyntaxRange; text: string }[] = []
  for (const field of AST.streamAllContents(document.parseResult.value).filter(AST.isEntityDataField)) {
    const traits = field.traits
    if (!traits || field.typeName || field.primitive || field.boolean) {
      continue
    }
    const relations = traits.traits.filter(trait => trait.relationName)
    const relation = relations[0]
    const name = AST.propertyRange(field, 'name')
    if (relations.length !== 1 || !relation || !name) {
      continue
    }
    edits.push({ range: { from: name.to, to: name.to }, text: ` ${relation.relationName}` })
    if (traits.traits.length === 1) {
      // Retain comments even when removing the now-empty trait list. A newline keeps a trailing
      // line comment from swallowing the data entry's comma.
      const comments = AST.commentRanges(traits).map(range => text.slice(range.from, range.to))
      edits.push({ range: AST.nodeRange(traits)!, text: comments.length ? `${comments.join('\n')}\n` : '' })
      continue
    }
    const relationRange = AST.nodeRange(relation)!
    const index = traits.traits.indexOf(relation)
    const next = traits.traits[index + 1]
    const gap = next
      ? { from: relationRange.to, to: AST.nodeRange(next)!.from }
      : { from: AST.nodeRange(traits.traits[index - 1]!)!.to, to: relationRange.from }
    const comments = AST.commentRanges(traits)
    const comma = Array.from({ length: gap.to - gap.from }, (_, offset) => gap.from + offset)
      .find(offset => text[offset] === ',' && !comments.some(range => offset >= range.from && offset < range.to))
    if (comma === undefined) {
      continue
    }
    edits.push({ range: relationRange, text: '' }, { range: { from: comma, to: comma + 1 }, text: '' })
  }
  return edits.length === 0 ? undefined : edits.sort((left, right) => right.range.from - left.range.from)
    .reduce((source, edit) => source.slice(0, edit.range.from) + edit.text + source.slice(edit.range.to), text)
}
