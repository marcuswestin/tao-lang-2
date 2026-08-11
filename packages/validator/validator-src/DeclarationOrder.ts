import { AST } from '@parser'
import { Switch } from '@shared'

export type ValueReferenceLike = AST.ValueReference | AST.MemberAccessExpression

/** DeclarationOrder groups source-order and ownership checks for value declarations. */
export const DeclarationOrder = {
  allowsForwardActionReference,
  isLocalValueDeclaration,
  isUsedBeforeDeclaration,
  isViewOwnedValueDeclaration,
  valueReferences,
}

/** valueReferences returns all value references owned by an expression. */
function valueReferences(value: AST.Expression): ValueReferenceLike[] {
  return Switch.type(value, {
    ActionExpression: expressionValueReferences,
    BinaryExpression: expressionValueReferences,
    BooleanLiteral: expressionValueReferences,
    WhenExpression: expressionValueReferences,
    FunctionCallExpression: expressionValueReferences,
    InterpolationExpression: expressionValueReferences,
    ListLiteral: expressionValueReferences,
    MemberAccessExpression: reference => [reference],
    NoneLiteral: expressionValueReferences,
    NumberLiteral: expressionValueReferences,
    StringLiteral: expressionValueReferences,
    TypedConstructor: expressionValueReferences,
    UnaryExpression: expressionValueReferences,
    ValueReference: reference => [reference],
  })
}

function expressionValueReferences(value: AST.Expression): ValueReferenceLike[] {
  return AST.streamAllContents(value).filter(isValueReferenceLike)
}

function isValueReferenceLike(node: AST.Node): node is ValueReferenceLike {
  return AST.isValueReference(node) || AST.isMemberAccessExpression(node)
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
  if (AST.getDocument(declaration) !== AST.getDocument(use)) {
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
    || AST.isQueryDeclaration(declaration)
    || AST.isForStatement(declaration)
}

/** isViewOwnedValueDeclaration returns true when a value belongs to a renderable declaration body. */
function isViewOwnedValueDeclaration(declaration: AST.ValueDeclaration): boolean {
  return AST.findOwningView(declaration) !== undefined
}

/** allowsForwardActionReference returns true for action-body references to actions declared later. */
function allowsForwardActionReference(declaration: AST.ValueDeclaration, use: AST.Node): boolean {
  return AST.isActionDeclaration(declaration) && AST.findOwningActionBlock(use) !== undefined
}
