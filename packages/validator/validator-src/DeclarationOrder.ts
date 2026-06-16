import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { ASTStructure } from '@parser/ASTStructure'

/** DeclarationOrder groups source-order and ownership checks for value declarations. */
export const DeclarationOrder = {
  allowsForwardActionReference,
  ancestorBlocks: ASTStructure.ancestorBlocks,
  findOwningAction: ASTStructure.findOwningAction,
  findOwningAlias: ASTStructure.findOwningAlias,
  findOwningState: ASTStructure.findOwningState,
  findOwningView: ASTStructure.findOwningView,
  findRoot: ASTStructure.findRoot,
  importableValueDeclarationsInFile: ASTStructure.importableValueDeclarationsInFile,
  isLocalValueDeclaration,
  isUsedBeforeDeclaration,
  isViewOwnedValueDeclaration,
  valueDeclarationsOwnedByBlock: ASTStructure.valueDeclarationsOwnedByBlock,
  valueReferences,
}

/** valueReferences returns all value references owned by an expression. */
function valueReferences(value: AST.Expression): AST.ValueReference[] {
  if (AST.isValueReference(value)) {
    return [value]
  }
  return ASTUtils.streamAllContents(value).filter(AST.isValueReference)
}

/** isUsedBeforeDeclaration returns true when `use` appears before `declaration` in the same document. */
function isUsedBeforeDeclaration<DeclarationT extends AST.ValueDeclaration>(
  declaration: DeclarationT | undefined,
  use: AST.Node,
): declaration is DeclarationT {
  return declaration !== undefined && !isDeclaredBefore(declaration, use)
}

function isDeclaredBefore(declaration: AST.ValueDeclaration, use: AST.Node): boolean {
  // Imported declarations initialize with their own module before this file's body runs,
  // so source-order rules only apply within one document.
  if (ASTUtils.getDocument(declaration) !== ASTUtils.getDocument(use)) {
    return true
  }
  const declarationOffset = declaration.$cstNode?.offset
  const useOffset = use.$cstNode?.offset
  return declarationOffset !== undefined && useOffset !== undefined && declarationOffset < useOffset
}

/** isLocalValueDeclaration returns true for value declarations owned by local Tao blocks/files. */
function isLocalValueDeclaration(declaration: AST.ValueDeclaration): boolean {
  return AST.isAliasDeclaration(declaration)
    || AST.isStateDeclaration(declaration)
    || AST.isActionDeclaration(declaration)
}

/** isViewOwnedValueDeclaration returns true when a value belongs to a renderable declaration body. */
function isViewOwnedValueDeclaration(declaration: AST.ValueDeclaration): boolean {
  return ASTStructure.findOwningView(declaration) !== undefined
}

/** allowsForwardActionReference returns true for action-body references to actions declared later. */
function allowsForwardActionReference(declaration: AST.ValueDeclaration, use: AST.Node): boolean {
  return AST.isActionDeclaration(declaration) && findOwningActionBlock(use) !== undefined
}

const findOwningActionBlock = ASTStructure.findOwningActionBlock
