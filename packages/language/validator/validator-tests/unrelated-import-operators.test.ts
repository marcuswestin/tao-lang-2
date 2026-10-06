import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { validationErrorMessages, withValidatedFiles } from './test-validate'

const duration = `
  public type Duration is numeric with {
    units { seconds 1 (default) }
    static func -(Left Duration, Right Duration) fails never -> Duration { return Left }
  }
`

Describe('validator: unrelated imported operators', () => {
  Test('keeps primitive subtraction available with a nonmatching imported nominal operator', async () => {
    await withValidatedFiles('Library.tao', {
      'Library.tao': `
        use Duration from ./quantities/Duration
        func Subtract(Left number, Right number) -> number { return Left - Right }
      `,
      'quantities/Duration.tao': duration,
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
      const expression = AST.streamAllContents(result.entry.ast).find(AST.isBinaryExpression)
      Expect.Is(expression, AST.isBinaryExpression)
      const operation = Type.associatedOperation(expression)
      Expect(operation.problem).toBe('missing-operator')
      Expect(operation.candidates).toHaveLength(1)
      Expect(operation.candidates[0]!.descriptor.owner.name).toBe('Duration')
      Expect(operation.operandTypes.map(type => [type.kind, type.kind === 'primitive' ? type.primitive : undefined]))
        .toEqual([['primitive', 'number'], ['primitive', 'number']])
      Expect(Type.displayName(Type.ofExpression(expression))).toBe('number')
    })
  })

  Test('still requires an authored contract for nominal numeric subtraction', async () => {
    await withValidatedFiles('Library.tao', {
      'Library.tao': `
        use Duration from ./quantities/Duration
        type Distance is numeric with { units { metres 1 (default) } }
        func Subtract(Left Distance, Right Distance) -> Distance { return Left - Right }
      `,
      'quantities/Duration.tao': duration,
    }, result => {
      const expression = AST.streamAllContents(result.entry.ast).find(AST.isBinaryExpression)
      Expect.Is(expression, AST.isBinaryExpression)
      const operation = Type.associatedOperation(expression)
      Expect(operation.problem).toBe('missing-operator')
      Expect(operation.operandTypes.map(Type.displayName)).toEqual(['Distance', 'Distance'])
      const expected = FunctionalCoreValidator.messages.authoredContract('-', 'missing-operator')
      Expect(validationErrorMessages(result)).toContain(expected)
      const diagnostic = result.diagnostics.find(candidate => candidate.message === expected)
      Expect(diagnostic?.source).toBe('validator')
      Expect(diagnostic?.range).toEqual(expression.$cstNode!.range)
      Expect(Type.ofExpression(expression).kind).toBe('unresolved')
    })
  })
})
