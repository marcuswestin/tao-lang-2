import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: pick value expressions', () => {
  Test('retains actual predicate and subject branches in the value expression', async () => {
    const result = await testParseSyntax(`
      func Earlier(Left number, Right number) -> number {
        return pick { Left <= Right -> Left otherwise -> Right }
      }
      func Label(Value yes/no) -> text {
        return pick Value { yes -> "yes" no -> "no" }
      }
    `)
    const picks = AST.streamAllContents(result.entry.ast).filter(AST.isWhenExpression)
    Expect(picks).toHaveLength(2)
    Expect(picks.every(pick => pick.pickSyntax)).toBe(true)
    const predicate = picks[0]!
    Expect(predicate.subject).toBeUndefined()
    Expect.Is(predicate.branches[0]?.condition, AST.isBinaryExpression)
    Expect(predicate.branches[0]?.condition.operator).toBe('<=')
    Expect.Is(predicate.branches[0]?.value, AST.isValueReference)
    Expect.Is(predicate.otherwise?.value, AST.isValueReference)
    const subject = picks[1]!
    Expect.Is(subject.subject, AST.isValueReference)
    Expect(subject.branches.map(branch => branch.case)).toEqual(['yes', 'no'])
    Expect(subject.otherwise).toBeUndefined()
  })

  Test('preserves the legacy value-selection input', async () => {
    const result = await testParseSyntax(
      'func Label(Value yes/no) { return when Value { yes -> "yes" otherwise -> "no" } }',
    )
    const selection = AST.streamAllContents(result.entry.ast).find(AST.isWhenExpression)
    Expect.Is(selection, AST.isWhenExpression)
    Expect(selection.pickSyntax).toBe(false)
  })
})
