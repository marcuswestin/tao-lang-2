import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { sourceActionResult } from '../ast-utils-src/source-action-results'

Describe('Source action result values', () => {
  Test('collects typed returns from the synchronous action scope in source order', async () => {
    const parsed = await Parser.parseCode(`
      action Finish() { }
      action Export() -> number {
        if true { return 1 }
        let Inline = action { return 2 }
        async { return 3 }
        defer { return 4 }
        do Finish() then { done -> { return 6 } }
        when do Finish() { done -> { return 7 } }
        return 5
      }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const action = parsed.entry.ast.statements.find(
      statement => AST.isActionDeclaration(statement) && statement.name === 'Export',
    )
    Expect.Is(action, AST.isActionDeclaration)

    const resolvedExpressions: AST.Expression[] = []
    const results = sourceActionResult(action, value => {
      resolvedExpressions.push(value)
      return resolvedExpressions.length
    })

    Expect(results.map(result => result.type)).toEqual([1, 2])
    Expect(results.map(result => AST.isNumberLiteral(result.value) && result.value.value)).toEqual([1, 5])
    Expect(resolvedExpressions).toHaveLength(2)
    Expect(results[0]!.value === resolvedExpressions[0]).toBe(true)
    Expect(results[1]!.value === resolvedExpressions[1]).toBe(true)
    Expect(results.every(result => result.statement.value === result.value)).toBe(true)
  })

  Test('does not treat foreign declarations as source result owners', async () => {
    const parsed = await Parser.parseCode('action Native() -> number from ./Native.ts')
    Expect(parsed.diagnostics).toEqual([])
    const action = parsed.entry.ast.statements.find(
      statement => AST.isActionDeclaration(statement) && statement.name === 'Native',
    )
    Expect.Is(action, AST.isActionDeclaration)
    Expect(sourceActionResult(action, value => value)).toEqual([])
  })
})
