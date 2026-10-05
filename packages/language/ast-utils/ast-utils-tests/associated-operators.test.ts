import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { Type } from '../ast-utils-src/Type'

Describe('Authored operator resolution', () => {
  Test(
    'discovers right operand and result owners while retaining authored order and declaration conflicts',
    async () => {
      const parsed = await Parser.parseCode(
        `
      type Scale is number with {
        static func *(First number, Second Scale) fails never -> number { return First }
        func <(Second number) fails never -> boolean { return yes }
      }
      type Left is number
      type Right is number
      type Product is number with {
        static func *(First Left, Second Right) fails never -> Product { return Product 0 }
      }
      type DuplicateOne is number with {
        static func +(First Left, Second Right) fails never -> Product { return Product 0 }
      }
      type DuplicateTwo is number with {
        static func +(First Left, Second Right) fails never -> Product { return Product 0 }
      }
      type Pending is number with {
        static func *(First Scale, Second Scale) { return Missing }
      }
      func RightOwner(First number, Second Scale) { return First * Second }
      func RightReversed(First Scale, Second number) { return First * Second }
      func ResultOwner(First Left, Second Right) { return First * Second }
      func ResultReversed(First Right, Second Left) { return First * Second }
      func Duplicate(First Left, Second Right) { return First + Second }
      func WrongReceiver(First number, Second Scale) { return First < Second }
    `,
        { validation: false },
      )
      Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
      const functions = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration)
      const resolve = (name: string) => {
        const expression = AST.returnStatementsOf(functions.find(fn => fn.name === name)!)[0]!.value
        Expect.Is(expression, AST.isBinaryExpression)
        return Type.associatedOperation(expression)
      }
      const right = resolve('RightOwner')
      Expect(right.problem).toBeUndefined()
      Expect(right.descriptor?.owner.name).toBe('Scale')
      Expect(right.pairs.map(pair => Type.displayName(pair.type))).toEqual(['number', 'Scale'])
      Expect(resolve('RightReversed').problem).toBe('missing-operator')
      const result = resolve('ResultOwner')
      Expect(result.problem).toBeUndefined()
      Expect(result.descriptor?.owner.name).toBe('Product')
      Expect(Type.displayName(result.result)).toBe('Product')
      Expect(resolve('ResultReversed').problem).toBe('missing-operator')
      Expect(resolve('WrongReceiver').problem).toBe('missing-operator')
      const duplicate = resolve('Duplicate')
      Expect(duplicate.problem).toBe('ambiguous-operator')
      Expect(duplicate.candidates.map(candidate => candidate.descriptor.owner.name)).toEqual([
        'DuplicateOne',
        'DuplicateTwo',
      ])
    },
  )

  Test('keeps resolver and expression typing unresolved before primitive builtins', async () => {
    const parsed = await Parser.parseCode(
      `
      func Add() { return Missing + 1 }
      func Compare() { return Missing < 1 }
      func Negate() { return -Missing }
      func Not() { return not Missing }
      func And() { return Missing and yes }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const expressions = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration).map(fn =>
      AST.returnStatementsOf(fn)[0]!.value
    )
    for (const expression of expressions) {
      Expect.Is(
        expression,
        (value): value is AST.BinaryExpression | AST.UnaryExpression =>
          AST.isBinaryExpression(value) || AST.isUnaryExpression(value),
      )
      if (expression.operator !== 'not' && expression.operator !== 'and') {
        Expect(Type.associatedOperation(expression).problem).toBe('unresolved-operand')
      }
      Expect(Type.ofExpression(expression).kind).toBe('unresolved')
    }
  })
  Test('selects actual primitive number declarations and distinguishes unary and binary overloads', async () => {
    const parsed = await Parser.parseCode(
      `
      primitive number with {
        static func +(Left number, Right number) fails never -> number { return Left }
        static func -(Left number, Right number) fails never -> number { return Left }
        static func -(Value number) fails never -> number { return Value }
        static func <(Left number, Right number) fails never -> boolean { return yes }
      }
      func Add(Left number, Right number) { return Left + Right }
      func Subtract(Left number, Right number) { return Left - Right }
      func Negate(Value number) { return -Value }
      func Compare(Left number, Right number) { return Left < Right }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const owner = parsed.entry.ast.statements.find(AST.isPrimitiveDeclaration)
    Expect.Is(owner, AST.isPrimitiveDeclaration)
    const operations = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration).map(fn => {
      const expression = AST.returnStatementsOf(fn)[0]!.value
      Expect.Is(
        expression,
        (value): value is AST.BinaryExpression | AST.UnaryExpression =>
          AST.isBinaryExpression(value) || AST.isUnaryExpression(value),
      )
      return Type.associatedOperation(expression)
    })
    Expect(operations.map(operation => operation.problem)).toEqual([undefined, undefined, undefined, undefined])
    Expect(operations.every(operation => operation.descriptor?.owner === owner)).toBe(true)
    Expect(operations.map(operation => operation.pairs.length)).toEqual([2, 2, 1, 2])
    Expect(operations.map(operation => Type.displayName(operation.result))).toEqual([
      'number',
      'number',
      'number',
      'boolean',
    ])
    Expect(Type.displayName(Type.ofAssociatedOwner(owner))).toBe('number')
  })
  Test('retains ordered overloaded contracts, inherited arithmetic domains and real operand anchors', async () => {
    const parsed = await Parser.parseCode(
      `
      type Scalar is numeric with {
        static func +(Left Scalar, Right Delta) fails never -> Scalar { return Left }
        static func +(Left Scalar, Right Scalar) fails never -> Scalar { return Left }
        static func *(Left Scalar, Right Delta) fails never -> Scalar { return Left }
        static func *(Left Scalar, Right Delta) fails never -> Delta { return Right }
        func -() fails never -> Scalar { return Scalar 0 }
        func <(Right Self) fails never -> boolean { return yes }
      }
      type Delta is numeric
      type Child is Scalar
      func Add(Left Child, Right Delta) -> Scalar { return Left + Right }
      func Same(Left Scalar, Right Scalar) -> Scalar { return Left + Right }
      func Reverse(Left Delta, Right Scalar) -> Scalar { return Left + Right }
      func Negate(Value Child) -> Scalar { return -Value }
      func Compare(Left Child, Right Child) -> boolean { return Left < Right }
      func Wide(Left Child, Right Scalar) -> boolean { return Left < Right }
      func Ambiguous(Left Scalar, Right Delta) { return Left * Right }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const file = parsed.entry.ast
    const operation = (name: string) => {
      const fn = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === name)
      Expect.Is(fn, AST.isFunctionDeclaration)
      const expression = AST.returnStatementsOf(fn)[0]!.value
      Expect.Is(
        expression,
        (value): value is AST.BinaryExpression | AST.UnaryExpression =>
          AST.isBinaryExpression(value) || AST.isUnaryExpression(value),
      )
      return { expression, resolved: Type.associatedOperation(expression) }
    }
    const addition = operation('Add')
    Expect(addition.resolved.problem).toBeUndefined()
    Expect(addition.resolved.dispatch).toBe('static')
    Expect(addition.resolved.candidates).toHaveLength(2)
    Expect(addition.resolved.operandDomains?.map(Type.displayName)).toEqual(['Scalar', 'Delta'])
    Expect(Type.displayName(addition.resolved.result)).toBe('Scalar')
    Expect(addition.resolved.descriptor?.signature.failures).toEqual({ cases: [], open: false })
    Expect.Is(addition.expression, AST.isBinaryExpression)
    Expect(addition.resolved.operands[0] === addition.expression.left).toBe(true)
    Expect(addition.resolved.pairs[1]?.operand === addition.expression.right).toBe(true)
    Expect(operation('Same').resolved.problem).toBeUndefined()
    Expect(operation('Reverse').resolved.problem).toBe('missing-operator')
    const negation = operation('Negate')
    Expect(negation.resolved.problem).toBeUndefined()
    Expect(negation.resolved.dispatch).toBe('instance')
    Expect(negation.resolved.pairs).toHaveLength(0)
    Expect(negation.resolved.receiver === negation.resolved.operands[0]).toBe(true)
    Expect(Type.displayName(negation.resolved.result)).toBe('Scalar')
    const comparison = operation('Compare').resolved
    Expect(comparison.problem).toBeUndefined()
    Expect(comparison.operandDomains?.map(Type.displayName)).toEqual(['Child', 'Child'])
    Expect(operation('Wide').resolved.problem).toBe('missing-operator')
    Expect(operation('Ambiguous').resolved.problem).toBe('ambiguous-operator')
    Expect(Type.displayName(Type.ofExpression(addition.expression))).toBe('Scalar')
  })

  Test('keeps bounded Self operands symbolic and rejects independent generic identities', async () => {
    const parsed = await Parser.parseCode(
      `
      can Ordered { <(Right Self) -> boolean }
      func Less where type T is Ordered (Left T, Right T) -> boolean { return Left < Right }
      func Independent where type T is Ordered, type U is Ordered (Left T, Right U) -> boolean { return Left < Right }
      can Arithmetic { +(Right Self) -> Self }
      func Sum where type T is Arithmetic (Left T, Right T) -> T { return Left + Right }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const operations = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration).map(fn => {
      const expression = AST.returnStatementsOf(fn)[0]!.value
      Expect.Is(expression, AST.isBinaryExpression)
      return Type.associatedOperation(expression)
    })
    Expect(operations[0]!.problem).toBeUndefined()
    Expect(operations[0]!.operandDomains?.map(Type.identityKey)).toEqual(
      operations[0]!.operandTypes.map(Type.identityKey),
    )
    Expect(operations[1]!.problem).toBe('missing-operator')
    Expect(operations[2]!.problem).toBeUndefined()
    Expect(Type.identityKey(operations[2]!.result)).toBe(Type.identityKey(operations[2]!.operandTypes[0]!))
  })

  Test('leaves method-level generic inference pending and never invents numeric storage operators', async () => {
    const parsed = await Parser.parseCode(
      `
      type Scalar is numeric with {
        static func + where type T is Scalar (Left T, Right T) -> T { return Left }
      }
      type Missing is numeric
      func Generic(Left Scalar, Right Scalar) { return Left + Right }
      func Storage(Left Missing, Right Missing) { return Left + Right }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const operations = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration).map(fn => {
      const expression = AST.returnStatementsOf(fn)[0]!.value
      Expect.Is(expression, AST.isBinaryExpression)
      return { expression, resolved: Type.associatedOperation(expression) }
    })
    Expect(operations[0]!.resolved.problem).toBe('pending-contract')
    Expect(operations[1]!.resolved.problem).toBe('missing-operator')
    Expect(Type.ofExpression(operations[1]!.expression).kind).toBe('unresolved')
  })
})
