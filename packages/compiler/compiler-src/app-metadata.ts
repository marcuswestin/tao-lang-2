import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'

/** Effective app identity is resolved through the same derivation as runtime app slots. */
export function appMetadata(app: AST.AppValueDeclaration): { appId: string; appVersion: string; displayName: string } {
  const configuration = ASTUtils.effectiveAppConfiguration(app)
  const literal = (name: 'id' | 'version' | 'name'): string => {
    const value = configuration.get(name)?.value
    Assert(value !== undefined && AST.isStringLiteral(value), `validated app ${name} is literal text`)
    return value.value
  }
  return { appId: literal('id'), appVersion: literal('version'), displayName: literal('name') }
}
