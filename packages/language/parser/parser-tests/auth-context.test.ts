import { Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('parser: auth context', () => {
  Test('preserves the library auth family and resolves Account at its consumer', async () => {
    await withTaoFiles('tao-auth-context-', {
      'Main.tao': `
        use Account, AuthProvider from @tao/auth
        type TestAuth is AuthProvider with { provider TestAuthProvider from ./TestAuth.ts }
        data Accounts / Account { DisplayName text, }
        let Provider = TestAuth { }
        let Me = Account
        let Label = Me.DisplayName
        let DirectLabel = Account.DisplayName
      `,
      'Packages/@tao/auth/Auth.tao': `
        public type AuthProvider is { }
        public let Account = none
      `,
    }, async (paths, rootDir) => {
      const workspace = await Workspace.open(rootDir)
      const result = await workspace.parse(paths['Main.tao']!)
      Expect(result.diagnostics).toEqual([])
      const providerType = result.entry.ast.statements.find(AST.isTypeDeclaration)!
      Expect(AST.configurationPrimitiveOf(providerType)).toBe('auth')
      const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)
      Expect(AST.configuredPrimitiveOfExpression(aliases[0]!.value)).toBe('auth')
      Expect(Type.ofExpression(aliases[1]!.value).kind).toBe('entity')
      Expect(Type.displayName(Type.ofExpression(aliases[2]!.value))).toBe('text')
      Expect(Type.displayName(Type.ofExpression(aliases[3]!.value))).toBe('text')
    }, { location: 'host' })
  })
})
