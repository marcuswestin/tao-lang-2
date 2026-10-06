import { AST } from '@parser'

/** SourceActionResultValue pairs one lexical source-action return with its caller-resolved value type. */
export interface SourceActionResultValue<TypeT> {
  statement: AST.ReturnStatement
  value: AST.Expression
  type: TypeT
}

/** sourceActionResult returns typed values from synchronous returns owned by one source action. */
export function sourceActionResult<TypeT>(
  action: AST.ActionDeclaration,
  resolveExpression: (value: AST.Expression) => TypeT,
): SourceActionResultValue<TypeT>[] {
  if (action.foreign || !action.block) {
    return []
  }

  return AST.streamAllContents(action.block)
    .filter(AST.isReturnStatement)
    .filter(statement => isSynchronousReturnOwnedBy(statement, action))
    .map(statement => ({ statement, value: statement.value, type: resolveExpression(statement.value) }))
}

function isSynchronousReturnOwnedBy(statement: AST.ReturnStatement, action: AST.ActionDeclaration): boolean {
  let current: AST.Node | undefined = statement.$container
  while (current && current !== action) {
    if (
      AST.isActionDeclaration(current)
      || AST.isActionExpression(current)
      || AST.isAsyncActionStatement(current)
      || AST.isDeferStatement(current)
      || AST.isWhenDoOutcome(current)
      || AST.isWhenDoOtherwise(current)
    ) {
      return false
    }
    current = current.$container
  }
  return current === action
}
