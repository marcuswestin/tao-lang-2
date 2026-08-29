import { AST } from '@parser'

/** guardBranches returns a guard statement's case-block branches or its single inline branch. */
export function guardBranches(statement: AST.GuardActionStatement): AST.GuardActionBranch[]
export function guardBranches(statement: AST.GuardRenderStatement): AST.GuardRenderBranch[]
export function guardBranches(
  statement: AST.GuardActionStatement | AST.GuardRenderStatement,
): (AST.GuardActionBranch | AST.GuardRenderBranch)[] {
  return statement.caseBlock?.branches ?? (statement.single ? [statement.single] : [])
}
