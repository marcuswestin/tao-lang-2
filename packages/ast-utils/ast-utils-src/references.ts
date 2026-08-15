import { AST } from '@parser'
import { Type } from './Type'

/** referencedNames returns every cross-referenced name in `file` outside of use statements. */
export function referencedNames(file: AST.TaoFile): Set<string> {
  const names = new Set<string>()
  for (const node of AST.streamAllContents(file)) {
    if (AST.isUseStatement(node)) {
      continue
    }
    for (const reference of AST.streamReferences(node)) {
      names.add(reference.reference.$refText)
    }
    if (AST.isNamedTypeReference(node)) {
      names.add(node.root)
    }
    if (isImportedShorthandPropertyReference(node)) {
      names.add(node.name)
    }
    if (AST.isInferredConfigurationConstructor(node) && AST.isAliasDeclaration(node.$container)) {
      names.add(node.$container.name)
    }
    if (AST.isInferredAppPropertyValue(node)) {
      names.add(node.$container.name)
    }
  }
  return names
}

function isImportedShorthandPropertyReference(node: AST.Node): node is AST.TypeProperty {
  if (!AST.isTypeProperty(node) || node.type) {
    return false
  }
  const definition = Type.shorthandPropertyDefinition(node)
  return !!definition && AST.getDocument(definition) !== AST.getDocument(node)
}
