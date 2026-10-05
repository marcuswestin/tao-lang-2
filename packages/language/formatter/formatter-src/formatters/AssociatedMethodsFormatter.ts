import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export const AssociatedMethodsFormatter = {
  /** CapabilityTypeExpression puts each required signature on its own indented line. */
  CapabilityTypeExpression(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.methods)
    f.lineSeparatedList(f.node.methods)
    f.commaLineList()
  },

  /** CapabilityMethodDeclaration formats one bodyless signature with its required result. */
  CapabilityMethodDeclaration(f) {
    f.noSpaceBefore('(')
    f.oneSpaceAround('fails')
    f.oneSpaceAround('->')
  },

  /** AssociatedFunctionDeclaration formats an implementation inside its owning item type. */
  AssociatedFunctionDeclaration(f) {
    f.oneSpaceAfter('func')
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
    f.oneSpaceAround('fails')
    f.oneSpaceAround('->')
    f.noSpaceBefore('(')
  },
} satisfies Partial<FormatHandlers>

/** canonicalFunctionSource migrates function keywords without touching comments or literal text. */
export function canonicalFunctionSource(document: AST.Document): string | undefined {
  const edits: { range: AST.SyntaxRange; text: string }[] = []
  for (const node of AST.streamAllContents(document.parseResult.value)) {
    if (!AST.isFunctionDeclaration(node)) {
      continue
    }
    const functionKeyword = AST.keywordRange(node, 'function')
    if (functionKeyword) {
      edits.push({ range: functionKeyword, text: 'func' })
    }
    const returnsKeyword = AST.keywordRange(node, 'returns')
    if (returnsKeyword) {
      edits.push({ range: returnsKeyword, text: '->' })
    }
  }
  if (edits.length === 0) {
    return undefined
  }
  return edits.sort((left, right) => right.range.from - left.range.from).reduce(
    (source, edit) => source.slice(0, edit.range.from) + edit.text + source.slice(edit.range.to),
    document.textDocument.getText(),
  )
}
