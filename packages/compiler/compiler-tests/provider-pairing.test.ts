import { Workspace } from '@compiler/workspace'
import { Describe, Expect, stubView, Test, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: provider pairing metadata', () => {
  Test('emits what an auth provider type issues and what a datasource type accepts and supports', async () => {
    const compiled = await Compiler.compileCode(`
      use AuthProvider from @tao/auth
      public type Door is AuthProvider with {
        issues { IdentityToken, Session }
        provider DoorProvider from ./DoorProvider.ts
      }
      public type Store is datasource with {
        accepts { Session from Door, TestIdentity }
        supports { Relations, Migrations Additive }
        provider StoreProvider from ./StoreProvider.ts
      }
      public type Closed is datasource with {
        supports { }
        provider ClosedProvider from ./ClosedProvider.ts
      }
      use StackNav from @tao/nav
      app Demo { id "com.tao.test.demo" version "1.0.0"
        name "Demo"
        Navigator StackNav { Initial Home }
        Auth Door { }
        Datasource Store { }
      }
      scene Home() { Title "Home" render Empty() }
      ${stubView('Empty')}
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toMatch(/TR\.Auth\.Declaration\( ?["']Door["'],[^;]*\{ issues: \["IdentityToken", "Session"\] \}/)
    Expect(code).toContain(
      '{ accepts: [{ kind: "Session", from: "Door" }, { kind: "TestIdentity" }], '
        + 'supports: [{ capability: "Relations" }, { capability: "Migrations", level: "Additive" }] }, )',
    )
    // No `accepts` block means the datasource accepts nothing, and the runtime is told so.
    Expect(code).toContain('{ accepts: [], supports: [] }, )')
  })

  Test('names an accepted auth type without importing its module', async () => {
    await withTaoFiles('tao-provider-pairing-', {
      'Main.tao': `
        use LocalAuth from @tao/auth/local
        use Reference from @tao/data/providers/reference
        use StackNav from @tao/nav
        ${stubView('Main')}
        data Accounts / Account { DisplayName text }
        app Notes { id "com.tao.test.notes" version "1.0.0"
          name "Notes"
          Navigator StackNav { Initial Main }
          Auth LocalAuth { Endpoint "http://127.0.0.1:4738" Resource "notes" }
          Datasource Reference { ServerURL "http://127.0.0.1:4738" Resource "notes" }
        }
      `,
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao'])
      const reference = result.files.find(file =>
        file.sourcePath.endsWith('/providers/reference/Reference.tao') && file.relativePath.endsWith('.tsx')
      )?.code.replace(/\s+/g, ' ') ?? ''
      const localAuth = result.files.find(file =>
        file.sourcePath.endsWith('/auth/local/LocalAuth.tao') && file.relativePath.endsWith('.tsx')
      )?.code.replace(/\s+/g, ' ') ?? ''

      Expect(reference).toContain(
        '{ accepts: [{ kind: "IdentityToken", from: "Clerk" }, { kind: "Session", from: "LocalAuth" }]',
      )
      Expect(localAuth).toContain('{ issues: ["Session"] }')
      // `from Clerk` is compared by name at runtime, so Reference's module never imports Clerk's,
      // and an app that pairs Reference with LocalAuth does not bundle the Clerk SDK.
      Expect(reference).not.toContain('__tao_type_Clerk')
      Expect(reference).not.toMatch(/import [^;]* from '[^']*auth\/clerk/)
      Expect(reference).not.toContain('__tao_type_LocalAuth')
    })
  })
})
