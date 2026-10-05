import { Workspace } from '@compiler/workspace'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import {
  numericUnitReadingCollisions,
  resolveNumericUnitReading,
} from '../ast-utils-src/numeric-unit-readings'
import { NumericUnits } from '../ast-utils-src/NumericUnits'
import { Type } from '../ast-utils-src/Type'

Describe('numeric unit readings', () => {
  Test('resolves direct, inherited, aliased, nested and postfix receivers to their real owners', async () => {
    const file = await parse(`
      type Measure is numeric with { units { seconds 1 (default), minutes 60 } }
      type Child is Measure
      type Alias is Child
      type Box is { Inner Child }
      func Direct(Value Measure) -> Measure { return Value.seconds() }
      func Inherited(Value Child) -> Child { return Value.minutes() }
      func Aliased(Value Alias) -> Alias { return Value.seconds() }
      func Nested(Value Box) -> Child { return Value.Inner.seconds() }
      func Relay(Value Child) -> Child { return Value }
      func Chained(Value Child) -> Child { return Relay(Value).seconds() }
    `)
    const span = namedType(file, 'Measure')
    const child = namedType(file, 'Child')
    const alias = namedType(file, 'Alias')
    const box = namedType(file, 'Box')
    Expect.Is(box.type, AST.isItemTypeExpression)
    const inner = box.type.properties[0]!
    const cases = [
      { functionName: 'Direct', owner: span, table: span, unitName: 'seconds' },
      { functionName: 'Inherited', owner: child, table: span, unitName: 'minutes' },
      { functionName: 'Aliased', owner: alias, table: span, unitName: 'seconds' },
      { functionName: 'Nested', owner: child, table: span, unitName: 'seconds' },
      { functionName: 'Chained', owner: child, table: span, unitName: 'seconds' },
    ] as const
    for (const example of cases) {
      const call = returnedCall(namedFunction(file, example.functionName))
      const resolution = resolveNumericUnitReading(call)
      Expect([example.functionName, resolution.kind]).toEqual([example.functionName, 'unit-reading'])
      if (resolution.kind !== 'unit-reading') {
        continue
      }
      const { reading } = resolution
      Expect(reading.invocation).toBe(call)
      Expect(reading.concreteFactoryOwner).toBe(example.owner)
      Expect(reading.unitOwner).toBe(example.table)
      Expect(reading.unit.$container.$container.$container).toBe(example.table.type)
      Expect(reading.unitName).toBe(example.unitName)
      Expect(reading.receiverType).toBe(reading.resultType)
      if (example.functionName === 'Nested') {
        Expect(reading.receiverType.kind).toBe('primitive')
        if (reading.receiverType.kind === 'primitive') {
          Expect(reading.receiverType.nominal).toBe(inner)
        }
      } else {
        Expect(Type.identityKey(reading.receiverType)).toBe(Type.identityKey(Type.ofParameter(
          AST.parametersOf(namedFunction(file, example.functionName))[0]!,
        )))
      }
      if (example.functionName === 'Nested') {
        Expect(reading.receiverAnchor.kind).toBe('member-path')
      }
      if (example.functionName === 'Chained') {
        Expect(reading.receiverAnchor.kind).toBe('expression')
        if (reading.receiverAnchor.kind === 'expression') {
          Expect.Is(call.callee, AST.isPostfixMemberAccess)
          Expect(reading.receiverAnchor.expression).toBe(call.callee.receiver)
        }
      }
    }
    Expect(NumericUnits.unitOwner(child)).toBe(span)
    Expect(NumericUnits.declarationPlan(child)?.owner).toBe(child)
  })

  Test('uses contextual receiver links and preserves lexical shadowing', async () => {
    const file = await parse(`
      type Measure is numeric with { units { seconds 1 (default), minutes 1 } }
      type Reader is Measure with { func Read() fails never -> Measure { return Reader.seconds() } }
      type Label is text with { func seconds() fails never -> Label { return Label "label" } }
      func Shadow(Measure Label) -> Label { return Measure.seconds() }
    `)
    const span = namedType(file, 'Measure')
    const label = namedType(file, 'Label')
    const reader = namedType(file, 'Reader')
    Expect(NumericUnits.unitOwner(reader)).toBe(span)
    const read = ownMethod(reader, 'Read')
    const contextual = returnedCall(read)
    Expect.Is(contextual.callee, AST.isMemberAccessExpression)
    Expect(AST.associatedReceiverOwner(contextual.callee)).toBe(reader)
    const resolvedContextual = resolveNumericUnitReading(contextual)
    Expect(resolvedContextual.kind).toBe('unit-reading')
    if (resolvedContextual.kind === 'unit-reading') {
      Expect(resolvedContextual.reading.concreteFactoryOwner).toBe(reader)
    }
    const shadowed = returnedCall(namedFunction(file, 'Shadow'))
    Expect(resolveNumericUnitReading(shadowed).kind).toBe('not-unit-reading')
    Expect(Type.displayName(Type.ofExpression(shadowed))).toBe('Label')
    Expect(Type.displayName(Type.ofDefinition(label))).toBe('Label')
    Expect(label.name).toBe('Label')
  })

  Test('returns non-readings for ordinary methods, other numeric owners and missing units', async () => {
    const file = await parse(`
      type Measure is numeric with { units { seconds 1 (default) } }
      type Other is numeric with { units { seconds 2 (default) } }
      type Label is text with { func lowercase() fails never -> Label { return Label "x" } }
      func Ordinary(Value Label) -> Label { return Value.lowercase() }
      func Different(Value Other) -> Other { return Value.seconds() }
      func Missing(Value Measure) -> Measure { return Value.hours() }
    `)
    for (const name of ['Ordinary', 'Missing']) {
      Expect(resolveNumericUnitReading(returnedCall(namedFunction(file, name))).kind).toBe('not-unit-reading')
    }
    const ordinary = returnedCall(namedFunction(file, 'Ordinary'))
    Expect(Type.displayName(Type.ofExpression(ordinary))).toBe('Label')
    const other = namedType(file, 'Other')
    const different = returnedCall(namedFunction(file, 'Different'))
    const resolution = resolveNumericUnitReading(different)
    Expect(resolution.kind).toBe('unit-reading')
    if (resolution.kind === 'unit-reading') {
      Expect(resolution.reading.concreteFactoryOwner).toBe(other)
      Expect(resolution.reading.unitOwner).toBe(other)
    }
  })

  Test('reports supplied arguments and real inherited associated-method collisions', async () => {
    const file = await parse(`
      type Measure is numeric with { units { ticks 1 (default), minutes 1 } }
      type Child is Measure with { func ticks() fails never -> Child { return Child } }
      type Parent is Measure with { func minutes() fails never -> Parent { return Parent } }
      type Descendant is Parent
      func Supplied(Value Measure) -> Measure { return Value.ticks(1) }
      func Collision(Value Child) -> Child { return Value.ticks() }
      func InheritedCollision(Value Descendant) -> Descendant { return Value.minutes() }
    `)
    const supplied = resolveNumericUnitReading(returnedCall(namedFunction(file, 'Supplied')))
    Expect(supplied.kind).toBe('invalid-unit-reading')
    if (supplied.kind === 'invalid-unit-reading') {
      Expect(supplied.problem).toBe('arguments')
      Expect(supplied.reading.unit.name).toBe('ticks')
    }
    for (const name of ['Collision', 'InheritedCollision']) {
      const resolution = resolveNumericUnitReading(returnedCall(namedFunction(file, name)))
      Expect(resolution.kind).toBe('invalid-unit-reading')
      if (resolution.kind === 'invalid-unit-reading') {
        Expect(resolution.problem).toBe('associated-method-collision')
      }
    }
    const child = namedType(file, 'Child')
    const parent = namedType(file, 'Parent')
    Expect(numericUnitReadingCollisions(child).map(collision => [collision.unit.name, collision.method.name]))
      .toEqual([['ticks', 'ticks']])
    Expect(numericUnitReadingCollisions(parent).map(collision => [collision.unit.name, collision.method.name]))
      .toEqual([['minutes', 'minutes']])
  })

  Test('fails closed for linked alias cycles', async () => {
    await withTaoFiles('tao-numeric-unit-reading-cycles-', {
      'Main.tao': 'use package ./first as first\nlet Value = first.First',
      'first.tao': 'use package ./second as second\npublic type First = second.Second',
      'second.tao': 'use package ./first as first\npublic type Second = first.First',
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      const first = result.files.find(file => file.path === paths['first.tao'])?.ast.statements.find(statement =>
        AST.isTypeDeclaration(statement) && statement.name === 'First'
      )
      Expect.Is(first, AST.isTypeDeclaration)
      Expect(NumericUnits.unitOwner(first)).toBeUndefined()
    })
  })
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  return parsed.entry.ast
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = file.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}

function ownMethod(owner: AST.TypeDeclaration, name: string): AST.AssociatedFunctionDeclaration {
  const type = owner.type
  const method = type && AST.isDerivedTypeExpression(type)
    ? type.slots.methods.find(candidate => candidate.name === name)
    : undefined
  Expect.Is(method, AST.isAssociatedFunctionDeclaration)
  return method
}

function returnedCall(
  declaration: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration,
): AST.MethodCallExpression {
  const returned = AST.returnStatementsOf(declaration)[0]?.value
  Expect.Is(returned, AST.isMethodCallExpression)
  return returned
}
