import { AST } from '@parser'
import { Type } from './Type'

/** referencedNames returns every cross-referenced name in `file` outside of use statements. */
export function referencedNames(file: AST.TaoFile): Set<string> {
  const names = new Set<string>()
  const dataEntitiesBySingularName = new Map(
    Type.visibleDataEntities(file).map(entity => [entity.singularName, entity]),
  )
  for (const node of AST.streamAllContents(file)) {
    if (AST.isUseStatement(node)) {
      continue
    }
    if (AST.isEntityQueryDeclaration(node) && !node.source) {
      // A root query names its collection syntactically: `query Notes` stores `Notes` as the
      // query's own name, while `query Notes as CurrentNote` stores it as `sourceName`. Neither
      // form is a Langium cross-reference, but both keep the collection import in use.
      names.add(node.sourceName ?? node.name)
    }
    for (const reference of AST.streamReferences(node)) {
      names.add(reference.reference.$refText)
      const target = 'ref' in reference.reference ? reference.reference.ref : undefined
      if (AST.isEntityDataDeclaration(target)) {
        // A data import names its plural declaration, while Tao source may refer to the declaration
        // through its singular entity name (`Document`). Keep the owning `Documents` import too.
        names.add(target.name)
      }
      if (AST.isCaseSetCase(target)) {
        // Importing a one-of type also imports its cases. A case reference therefore uses the
        // owning type import even when the type name never appears separately in source.
        names.add(AST.caseSetOwningCase(target).name)
      }
    }
    if (AST.isNamedTypeReference(node)) {
      names.add(node.root)
      const dataEntity = dataEntitiesBySingularName.get(node.root)
      if (dataEntity) {
        names.add(dataEntity.name)
      }
    }
    if (isImportedShorthandPropertyReference(node)) {
      names.add(node.name)
    }
    if (AST.isInferredConfigurationConstructor(node)) {
      const owner = node.$container
      const inferredName = AST.isAliasDeclaration(owner) || AST.isAppProperty(owner) ? owner.name : undefined
      if (inferredName) {
        // Bare configuration blocks resolve through their owner's same-name declaration without an
        // explicit AST cross-reference. Keep that declaration's import as a semantic reference.
        names.add(inferredName)
      }
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
