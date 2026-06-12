import { AST, Langium } from '@parser'
import { streamAllContents } from './traversal'

/** referencedNames returns every cross-referenced name in `file` outside of use statements. */
export function referencedNames(file: AST.TaoFile): Set<string> {
  const names = new Set<string>()
  for (const node of streamAllContents(file)) {
    if (AST.isUseStatement(node)) {
      continue
    }
    for (const reference of Langium.AstUtils.streamReferences(node)) {
      names.add(reference.reference.$refText)
    }
  }
  return names
}
