import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { testValidateCode, testValidateCodeWithErrors } from './test-validate'

const scalar = `
  abstract type Scalar is numeric with {
    static func +(Left Self, Right Self) fails never -> Self { return Left }
    static func -(Value Self) fails never -> Self { return Value }
    static func <(Left Self, Right Self) fails never -> boolean { return yes }
  }
`

Describe('validator: static contextual Self operators', () => {
  Test('reports erased abstract arithmetic at the actual binary and unary source sites', async () => {
    const result = await testValidateCodeWithErrors(`${scalar}
      func Erased(Left Scalar, Right Scalar) -> Scalar { return Left + Right }
      func Negate(Value Scalar) -> Scalar { return -Value }
      func Compare(Left Scalar, Right Scalar) -> boolean { return Left < Right }
    `)
    Expect(result.entry.document.parseResult.parserErrors).toHaveLength(0)
    const expressions = AST.streamAllContents(result.entry.ast).filter(node =>
      AST.isBinaryExpression(node) || AST.isUnaryExpression(node)
    )
    Expect(expressions).toHaveLength(3)
    for (const expression of expressions) {
      const resolved = Type.associatedOperation(expression)
      Expect(resolved.problem).toBe('missing-operator')
      const expected = FunctionalCoreValidator.messages.authoredContract(expression.operator, resolved.problem)
      const diagnostic = result.diagnostics.find(diagnostic => diagnostic.message === expected)
      Expect(diagnostic).toBeDefined()
      Expect(diagnostic?.source).toBe('validator')
      Expect(diagnostic?.range).toEqual(expression.$cstNode!.range)
    }
  })

  Test('accepts authentic concrete Self domains for arithmetic and comparison', async () => {
    await testValidateCode(`${scalar}
      type Distance is Scalar with { units { metres 1 (default) } }
      type PreciseDistance is Distance
      func ParentChild(Left Distance, Right PreciseDistance) -> Distance { return Left + Right }
      func ChildParent(Left PreciseDistance, Right Distance) -> Distance { return Left + Right }
      func Child(Left PreciseDistance, Right PreciseDistance) -> PreciseDistance { return Left + Right }
      func Compare(Left Distance, Right PreciseDistance) -> boolean { return Left < Right }
    `)
  })
})
