import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('parser: named failure import aliases', () => {
  Test('links a renamed record failure and its callable bound to the original declaration', async () => {
    await withTaoFiles('tao-failure-import-alias-', {
      'Main.tao': `
        use InvalidInput as Rejected from ./Failures
        action Commit() { fail Rejected "Enter a title" }
        action FromNative() fails Rejected "Rejected input" from ./Native.ts
      `,
      'Failures.tao': 'public type InvalidInput is { Message text }',
      'Native.ts': 'export function FromNative() {}',
    }, async paths => {
      const parsed = await Workspace.parse(paths['Main.tao']!)
      Expect(parsed.diagnostics).toEqual([])
      const use = parsed.entry.ast.statements.find(AST.isUseStatement)
      Expect.Is(use, AST.isUseStatement)
      const original = AST.resolvedImportedDeclarations(use).find(AST.isTypeDeclaration)
      Expect.Is(original, AST.isTypeDeclaration)
      const statements = [...AST.streamAllContents(parsed.entry.ast)]
      const failure = statements.find(AST.isFailStatement)
      Expect.Is(failure, AST.isFailStatement)
      const bound = statements.find(AST.isActionFailureDeclaration)
      Expect.Is(bound, AST.isActionFailureDeclaration)
      Expect(failure.case.ref).toBe(original)
      Expect(bound.case.ref).toBe(original)
    })
  })
})
