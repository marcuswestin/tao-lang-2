import { Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Assert, Diagnostics } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('compiler: built-in workspace operations', () => {
  Test('compiles validated ordinary number operators through imported inline receiving roles', async () => {
    await withTaoFiles('tao-builtin-workspace-operations-', {
      'Main.tao': `
        use all from ./Library
        public let Difference = Subtract(Left: 9, Right: 4)
        public let Negative = Negate(Value: 3)
        app Demo { id "com.tao.builtin.operators" version "1.0.0" name "Operators" view Home }
        view Home() from ./Native.tsx
      `,
      'Library.tao': `
        public func Subtract(Left number, Right number) -> number { return Left - Right }
        public func Negate(Value number) -> number { return -Value }
      `,
      'Native.tsx': 'export function Home() { return null }',
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const validation = await workspace.validate(paths['Main.tao']!)
      Expect(Diagnostics.errorMessages(validation.diagnostics)).toEqual([])
      const library = validation.files.find(file => file.path === paths['Library.tao'])!
      for (const fn of library.ast.statements.filter(AST.isFunctionDeclaration)) {
        const expression = AST.returnStatementsOf(fn)[0]!.value
        Expect(Type.displayName(Type.ofExpression(expression))).toBe('number')
      }
      const result = await workspace.compile(paths['Main.tao']!)
      const emitted = result.files.find(file =>
        file.sourcePath === paths['Library.tao'] && file.relativePath.endsWith('.tsx')
      )
      Assert.defined(emitted, 'the validated imported operator source reaches the backend')
      Expect(emitted.code).toContain('TR.Binary')
      Expect(emitted.code).toContain('TR.Unary')
    })
  })
})
