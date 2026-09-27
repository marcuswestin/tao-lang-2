import { AST } from '@parser'
import { Type } from './Type'

/**
 * referencedNames returns the external and unresolved names used in `file` outside of use statements.
 * `runtimeOnly` leaves out the auth provider types named by `accepts { Kind from Auth }`: pairing
 * compares that type by name, so naming it needs no runtime import of its module.
 */
export function referencedNames(file: AST.TaoFile, options: { runtimeOnly?: boolean } = {}): Set<string> {
  const names = new Set<string>()
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
      const target = 'ref' in reference.reference ? reference.reference.ref : undefined
      if (target === undefined || AST.findRoot(target) !== file) {
        // Local bindings do not use a same-spelled import. Keep unresolved references while the
        // author is editing, and external references including implicitly visible folder members.
        names.add(reference.reference.$refText)
      }
      if (AST.isCaseSetCase(target)) {
        // Importing a one-of type also imports its cases. A case reference therefore uses the
        // owning type import even when the type name never appears separately in source.
        names.add(AST.caseSetOwningCase(target).name)
      }
    }
    if (AST.isNamedTypeReference(node) && !(options.runtimeOnly && AST.isConfigurationAcceptedProof(node.$container))) {
      names.add(node.root)
    }
    if (AST.isEntityDataField(node) && !node.primitive && !node.boolean) {
      // Data relationship types are stored as names rather than cross-references. Both explicit
      // target types and same-name fields use only the exact singular or plural form they spell.
      names.add(Type.dataFieldRelationName(node))
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
