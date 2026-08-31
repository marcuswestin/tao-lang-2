import { type ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'

/** referencedConfigurationType resolves the shared declaration tail for configuration values. */
export function referencedConfigurationType(declaration: AST.Node | undefined): ASTUtils.TaoType {
  if (AST.isTypeDeclaration(declaration)) {
    return Type.ofDefinition(declaration)
  }
  if (
    AST.isAliasDeclaration(declaration) || AST.isViewDeclaration(declaration) || AST.isStateDeclaration(declaration)
  ) {
    return Type.ofValueDeclaration(declaration)
  }
  return { kind: 'unresolved' }
}
