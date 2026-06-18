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
    if (AST.isTypeProperty(node) && !node.type && shorthandResolvesToImportedType(file, node.name)) {
      names.add(node.name)
    }
  }
  return names
}

function shorthandResolvesToImportedType(file: AST.TaoFile, name: string): boolean {
  if (file.statements.some(statement => AST.isTypeDeclaration(statement) && statement.name === name)) {
    return false
  }
  return file.statements
    .filter(AST.isUseStatement)
    .some(useStatement =>
      useStatement.importedDeclarations.some(reference =>
        reference.$refText === name && AST.isTypeDeclaration(reference.ref)
      )
    )
}
