import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { Type } from '../ast-utils-src/Type'

const scalarDeclarations = `
  abstract type Scalar is numeric with {
    static func +(Left Self, Right Self) fails never -> Self { return Left }
    static func -(Left Self, Right Self) fails never -> Self { return Left }
    static func -(Value Self) fails never -> Self { return Value }
    static func *(Left Self, Right number) fails never -> Self { return Left }
    static func *(Left number, Right Self) fails never -> Self { return Right }
    static func /(Left Self, Right number) fails never -> Self { return Left }
    static func <(Left Self, Right Self) fails never -> boolean { return yes }
  }
  type Distance is Scalar with { units { metres 1 (default), centimetres 0.01 } }
  type PreciseDistance is Distance
  type SiblingDistance is Distance
  type Duration is Scalar with { units { seconds 1 (default) } }
`

async function operations(source: string) {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
  return (name: string) => {
    const declaration = parsed.entry.ast.statements.find(node => AST.isFunctionDeclaration(node) && node.name === name)
    Expect.Is(declaration, AST.isFunctionDeclaration)
    const expression = AST.returnStatementsOf(declaration)[0]!.value
    Expect.Is(
      expression,
      (value): value is AST.BinaryExpression | AST.UnaryExpression =>
        AST.isBinaryExpression(value) || AST.isUnaryExpression(value),
    )
    const resolved = Type.associatedOperation(expression)
    const contract = Type.associatedOperatorContract(expression.operator, resolved.operandTypes, expression)
    Expect(contract.problem).toBe(resolved.problem)
    Expect(contract.descriptor?.declaration === resolved.descriptor?.declaration).toBe(true)
    Expect(contract.operandDomains?.map(Type.identityKey)).toEqual(resolved.operandDomains?.map(Type.identityKey))
    Expect(Type.identityKey(contract.result)).toBe(Type.identityKey(resolved.result))
    return { expression, resolved }
  }
}

Describe('Static contextual Self operators', () => {
  Test('admits authentic quantity children upward without admitting descendants or siblings', async () => {
    const parsed = await Parser.parseCode(scalarDeclarations, { validation: false })
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const domain = (name: string) => {
      const declaration = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === name)
      Expect.Is(declaration, AST.isTypeDeclaration)
      return Type.ofDefinition(declaration)
    }
    const parent = domain('Distance')
    const child = domain('PreciseDistance')
    const sibling = domain('SiblingDistance')
    const unrelated = domain('Duration')
    Expect(Type.isCallableAssignable(child, parent)).toBe(true)
    Expect(Type.isCallableAssignable(parent, child)).toBe(false)
    Expect(Type.isCallableAssignable(child, sibling)).toBe(false)
    Expect(Type.isCallableAssignable(sibling, child)).toBe(false)
    Expect(Type.isCallableAssignable(child, unrelated)).toBe(false)
    Expect(Type.isCallableAssignable(child, domain('Scalar'))).toBe(true)
  })

  Test('anchors arithmetic to declared left, right and unary source operand domains', async () => {
    const operation = await operations(`${scalarDeclarations}
      func AddDistance(Left Distance, Right Distance) { return Left + Right }
      func AddChild(Left PreciseDistance, Right PreciseDistance) { return Left + Right }
      func Subtract(Left Distance, Right Distance) { return Left - Right }
      func Negate(Value PreciseDistance) { return -Value }
      func MultiplyLeft(Left PreciseDistance, Right number) { return Left * Right }
      func MultiplyRight(Left number, Right PreciseDistance) { return Left * Right }
      func Divide(Left PreciseDistance, Right number) { return Left / Right }
    `)
    const cases = [
      ['AddDistance', ['Distance', 'Distance'], 'Distance'],
      ['AddChild', ['PreciseDistance', 'PreciseDistance'], 'PreciseDistance'],
      ['Subtract', ['Distance', 'Distance'], 'Distance'],
      ['Negate', ['PreciseDistance'], 'PreciseDistance'],
      ['MultiplyLeft', ['PreciseDistance', 'number'], 'PreciseDistance'],
      ['MultiplyRight', ['number', 'PreciseDistance'], 'PreciseDistance'],
      ['Divide', ['PreciseDistance', 'number'], 'PreciseDistance'],
    ] as const
    for (const [name, domains, result] of cases) {
      const { expression, resolved } = operation(name)
      Expect(resolved.problem).toBeUndefined()
      Expect(resolved.dispatch).toBe('static')
      Expect(resolved.descriptor?.owner.name).toBe('Scalar')
      Expect(Type.displayName(resolved.descriptor!.receiver)).toBe(result)
      Expect(resolved.operandDomains?.map(Type.displayName)).toEqual(domains)
      Expect(Type.displayName(resolved.result)).toBe(result)
      Expect(Type.displayName(Type.ofExpression(expression))).toBe(result)
      Expect(resolved.descriptor?.signature.failures).toEqual({ cases: [], open: false })
      const inputs = AST.parametersOf(resolved.descriptor!.declaration)
      Expect(resolved.pairs).toHaveLength(inputs.length)
      Expect(resolved.pairs.every((pair, index) => pair.parameter === inputs[index])).toBe(true)
      Expect(resolved.pairs.every((pair, index) => pair.operand === resolved.operands[index])).toBe(true)
      Expect(resolved.receiver).toBeUndefined()
    }
  })

  Test(
    'rejects erased abstract Self arithmetic and comparisons without a concrete domain',
    async () => {
      const operation = await operations(`${scalarDeclarations}
      func Erased(Left Scalar, Right Scalar) -> Scalar { return Left + Right }
      func Negate(Value Scalar) -> Scalar { return -Value }
      func Compare(Left Scalar, Right Scalar) -> boolean { return Left < Right }
    `)
      for (const name of ['Erased', 'Negate', 'Compare']) {
        const { expression, resolved } = operation(name)
        Expect(resolved.problem).toBe('missing-operator')
        Expect(resolved.descriptor).toBeUndefined()
        Expect(Type.ofExpression(expression).kind).toBe('unresolved')
      }
    },
  )

  Test('selects a supplied common ancestor in either order and rejects siblings and unrelated quantities', async () => {
    const operation = await operations(`${scalarDeclarations}
      func ChildParent(Left PreciseDistance, Right Distance) { return Left + Right }
      func ParentChild(Left Distance, Right PreciseDistance) { return Left + Right }
      func Compare(Left PreciseDistance, Right Distance) { return Left < Right }
      func Siblings(Left PreciseDistance, Right SiblingDistance) { return Left + Right }
      func Quantities(Left Distance, Right Duration) { return Left + Right }
    `)
    for (const name of ['ChildParent', 'ParentChild']) {
      const { resolved } = operation(name)
      Expect(resolved.problem).toBeUndefined()
      Expect(resolved.operandDomains?.map(Type.displayName)).toEqual(['Distance', 'Distance'])
      Expect(Type.displayName(resolved.result)).toBe('Distance')
      Expect(Type.displayName(resolved.descriptor!.receiver)).toBe('Distance')
    }
    const comparison = operation('Compare').resolved
    Expect(comparison.problem).toBeUndefined()
    Expect(comparison.operandDomains?.map(Type.displayName)).toEqual(['Distance', 'Distance'])
    Expect(Type.displayName(comparison.result)).toBe('boolean')
    Expect(operation('Siblings').resolved.problem).toBe('missing-operator')
    Expect(operation('Quantities').resolved.problem).toBe('missing-operator')
  })

  Test('keeps visible contextual numeric operators from capturing ordinary primitive builtins', async () => {
    const operation = await operations(`${scalarDeclarations}
      func Add(Left number, Right number) { return Left + Right }
      func Multiply(Left number, Right number) { return Left * Right }
      func Compare(Left number, Right number) { return Left < Right }
    `)
    for (const [name, result] of [['Add', 'number'], ['Multiply', 'number'], ['Compare', 'boolean']]) {
      const { expression, resolved } = operation(name!)
      Expect(resolved.problem).toBe('missing-operator')
      Expect(resolved.descriptor).toBeUndefined()
      Expect(Type.displayName(Type.ofExpression(expression))).toBe(result)
    }
  })

  Test('chooses the nearest actual defining owner for identical contextual operand domains', async () => {
    const operation = await operations(`
      abstract type Scalar is numeric with {
        static func +(Left Self, Right Self) fails never -> Self { return Left }
        static func <(Left Self, Right Self) fails never -> boolean { return yes }
      }
      type Duration is Scalar with {
        units { seconds 1 (default) }
        static func +(Left Self, Right Self) fails never -> Duration { return Left }
        static func <(Left Duration, Right Duration) fails never -> boolean { return no }
      }
      type PreciseDuration is Duration
      func Add(Left PreciseDuration, Right PreciseDuration) { return Left + Right }
      func Compare(Left Duration, Right Duration) { return Left < Right }
    `)
    const addition = operation('Add').resolved
    Expect(addition.problem).toBeUndefined()
    Expect(addition.descriptor?.owner.name).toBe('Duration')
    Expect(addition.operandDomains?.map(Type.displayName)).toEqual(['PreciseDuration', 'PreciseDuration'])
    Expect(Type.displayName(addition.result)).toBe('Duration')
    const comparison = operation('Compare').resolved
    Expect(comparison.problem).toBeUndefined()
    Expect(comparison.descriptor?.owner.name).toBe('Duration')
    Expect(comparison.candidates.map(candidate => candidate.descriptor.owner.name)).toEqual(['Duration', 'Scalar'])
    Expect(comparison.operandDomains?.map(Type.displayName)).toEqual(['Duration', 'Duration'])
  })

  Test('retains ambiguity for duplicate overloads on the same defining owner', async () => {
    const operation = await operations(`
      abstract type Scalar is numeric with {
        static func +(Left Self, Right Self) fails never -> Self { return Left }
      }
      type Distance is Scalar with {
        units { metres 1 (default) }
        static func +(Left Distance, Right Distance) fails never -> Distance { return Left }
        static func +(Left Distance, Right Distance) fails never -> number { return 0 }
      }
      func Add(Left Distance, Right Distance) { return Left + Right }
    `)
    Expect(operation('Add').resolved.problem).toBe('ambiguous-operator')
  })
})
