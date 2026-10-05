import { AST } from '@parser'
import { Switch } from '@shared'

export type ValueReferenceLike = AST.ValueReference | AST.RefinementExpression | AST.MemberAccessExpression

/** DeclarationOrder groups source-order and ownership checks for value declarations. */
export const DeclarationOrder = {
  allowsForwardActionReference,
  isLocalValueDeclaration,
  isUsedBeforeDeclaration,
  isValueReferenceLike,
  isViewOwnedValueDeclaration,
  valueReferences,
}

/** valueReferences returns all value references owned by an expression. */
function valueReferences(value: AST.Expression | AST.ConfiguredValue): ValueReferenceLike[] {
  if (AST.isConfiguredValue(value)) {
    return AST.streamAllContents(value).filter(isValueReferenceLike)
  }
  return Switch.type(value, {
    ActionExpression: expressionValueReferences,
    BinaryExpression: expressionValueReferences,
    NowExpression: expressionValueReferences,
    // The names a bridged expression uses are the sidecar's exports, not Tao value references.
    FromExpression: bridgedArgumentValueReferences,
    PostfixMemberAccess: expressionValueReferences,
    BooleanLiteral: expressionValueReferences,
    CaseTestExpression: expressionValueReferences,
    CopyExpression: expressionValueReferences,
    WhenExpression: expressionValueReferences,
    FunctionCallExpression: expressionValueReferences,
    InterpolatedString: expressionValueReferences,
    InferredConfigurationConstructor: expressionValueReferences,
    ListLiteral: expressionValueReferences,
    MemberAccessExpression: reference => [reference],
    NoneLiteral: expressionValueReferences,
    NumberLiteral: expressionValueReferences,
    NumericUnitConstruction: expressionValueReferences,
    PrimitiveConfigurationConstructor: expressionValueReferences,
    RefinementExpression: expressionValueReferences,
    StringLiteral: expressionValueReferences,
    TypedConstructor: expressionValueReferences,
    UnaryExpression: expressionValueReferences,
    ValueReference: reference => [reference],
  })
}

/** A bridged expression's Tao values are its arguments; its head name belongs to the module. */
function bridgedArgumentValueReferences(value: AST.FromExpression): ValueReferenceLike[] {
  return AST.isFunctionCallExpression(value.expression)
    ? (value.expression.argumentList?.arguments ?? []).flatMap(argument => valueReferences(argument.value))
    : []
}

function expressionValueReferences(value: AST.Expression): ValueReferenceLike[] {
  return AST.streamAllContents(value).filter(isValueReferenceLike)
}

/** isValueReferenceLike identifies expressions that read a value declaration by reference. */
function isValueReferenceLike(node: AST.Node): node is ValueReferenceLike {
  return AST.isValueReference(node) || AST.isRefinementExpression(node) || AST.isMemberAccessExpression(node)
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
    || AST.isAskStatement(declaration)
    || AST.isEntityQueryDeclaration(declaration)
    || AST.isForStatement(declaration)
}

/** isViewOwnedValueDeclaration returns true when a value belongs to a renderable declaration body. */
function isViewOwnedValueDeclaration(declaration: AST.ValueDeclaration): boolean {
  return AST.findOwningView(declaration) !== undefined
}

/**
 * allowsForwardActionReference returns true for action-body references to actions declared later,
 * and for a command's own body: a command declares what it will run rather than running it, so the
 * private procedure behind a verb may be written under the verb that names it.
 */
function allowsForwardActionReference(declaration: AST.ValueDeclaration, use: AST.Node): boolean {
  return AST.isActionDeclaration(declaration)
    && (AST.findOwningActionBlock(use) !== undefined || AST.owningCommand(use) !== undefined)
}
