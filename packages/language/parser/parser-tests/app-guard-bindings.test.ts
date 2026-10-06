import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: app guard bindings', () => {
  Test('links context names before the arrow and retains the legacy input spelling', async () => {
    const parsed = await testParseSyntax(`
      app Canonical { guard { error Problem -> { "{Problem.Message}" } } }
      app Legacy { guard { error -> Problem { "{Problem.Message}" } } }
    `)
    for (const app of parsed.entry.ast.statements.filter(AST.isAppDeclaration)) {
      const guard = app.block?.statements.find(AST.isAppGuardStatement)
      Expect.Is(guard, AST.isAppGuardStatement)
      const branch = guard.branches[0]
      Expect.Is(branch, AST.isAppGuardBranch)
      Expect(branch.payload?.name).toBe('Problem')
      const reference = AST.streamAllContents(branch.block!).find(AST.isMemberAccessExpression)
      Expect.Is(reference, AST.isMemberAccessExpression)
      Expect(reference.target.ref).toBe(branch.payload)
    }
  })
})
