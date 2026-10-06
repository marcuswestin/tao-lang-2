import { ASTUtils, NumericUnits, Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { withQuantityFactoryBindings } from '../compiler-src/codegen/react-native/app/NumericUnitsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

async function compile(source: string) {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
  const owners = parsed.entry.ast.statements.filter((node): node is AST.TypeDeclaration | AST.PrimitiveDeclaration =>
    AST.isTypeDeclaration(node) || AST.isPrimitiveDeclaration(node)
  ).filter(owner => AST.isPrimitiveDeclaration(owner) ? !!owner.slots?.methods.length : !!owner.type)
  const bindings = new Map(owners.map((owner, index) => [owner, `_Witness${index}`]))
  const quantityOwners = owners.filter(AST.isTypeDeclaration).filter(owner => !!NumericUnits.declarationPlan(owner))
  const quantityBindings = new Map(quantityOwners.map((owner, index) => [owner, `_QuantityFactory${index}`]))
  const functions = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration)
  for (const fn of functions) {
    const expression = AST.returnStatementsOf(fn)[0]!.value
    Expect.Is(
      expression,
      (node): node is AST.BinaryExpression | AST.UnaryExpression =>
        AST.isBinaryExpression(node) || AST.isUnaryExpression(node),
    )
    Expect(Type.associatedOperation(expression).problem).toBeUndefined()
  }
  const effects = ASTUtils.createAssociatedEffects([parsed.entry.ast])
  const code = ASTUtils.withAssociatedEffects(
    effects,
    () =>
      withAssociatedWitnessBindings(bindings, () =>
        withQuantityFactoryBindings(quantityBindings, () =>
          [
            ...owners.map(owner => Langium.toString(Compile.AssociatedMethodsDeclaration(owner))),
            ...functions.map(fn => Langium.toString(Compile.FunctionDeclaration(fn))),
          ].join('\n'))),
  )
  const [{ default: TR }, { makeQuantityType }] = await Promise.all([
    import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot())),
    import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-quantity-values.ts', Repo.getRoot())),
  ])
  const quantityFactories = quantityOwners.map(owner => {
    const plan = NumericUnits.declarationPlan(owner)!
    return makeQuantityType({
      domain: owner.name,
      defaultUnit: plan.defaultUnit,
      units: Object.fromEntries(plan.units.map(unit => [unit.name, unit.scale])),
    }, TR.Value)
  })
  const scope: Record<string, any> = {}
  new Function(
    'TR',
    '_Scope',
    ...quantityBindings.values(),
    new Bun.Transpiler({ loader: 'ts' }).transformSync(code),
  )(TR, scope, ...quantityFactories)
  return { TR, scope }
}

Describe('compiler: authored operators', () => {
  Test('rejects pending and operation-free numeric contracts before runtime arithmetic emission', async () => {
    const parsed = await Parser.parseCode(
      `
      type Scalar is numeric with {
        static func + where type T is Scalar (Left T, Right T) -> T { return Left }
      }
      type Missing is numeric
      func Pending(Left Scalar, Right Scalar) { return Left + Right }
      func Absent(Left Missing, Right Missing) { return Left + Right }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    for (const fn of parsed.entry.ast.statements.filter(AST.isFunctionDeclaration)) {
      const expression = AST.returnStatementsOf(fn)[0]!.value
      Expect.Is(expression, AST.isBinaryExpression)
      Expect(() => Compile.Expression(expression)).toThrow('one authored contract or a resolved built-in domain')
    }
  })

  Test('keeps primitive static operands ordered and same-symbol unary and binary witnesses distinct', async () => {
    const { TR, scope } = await compile(`
      primitive number with {
        static func +(Left number, Right number) fails never -> number { return Right }
        static func -(Left number, Right number) fails never -> number { return Left }
        static func -(Value number) fails never -> number { return Value }
        static func <(Left number, Right number) fails never -> boolean { return yes }
      }
      func Add(Left number, Right number) -> number { return Left + Right }
      func Subtract(Left number, Right number) -> number { return Left - Right }
      func Negate(Value number) -> number { return -Value }
      func Less(Left number, Right number) -> boolean { return Left < Right }
    `)
    const left = TR.Value(3)
    const right = TR.Value(8)
    Expect(TR.Call(scope['Add'], left, right).getJSValue()).toBe(8)
    Expect(TR.Call(scope['Subtract'], left, right).getJSValue()).toBe(3)
    Expect(TR.Call(scope['Negate'], right).getJSValue()).toBe(8)
    Expect(TR.Call(scope['Less'], right, left).getJSValue()).toBe(true)
  })

  Test('executes the inherited owner with the exact instance receiver and declared static operand order', async () => {
    const { TR, scope } = await compile(`
      type Scalar is numeric with {
        units { scalar 1 (default) }
        static func +(Left Scalar, Right Delta) fails never -> Scalar { return Left }
        static func +(Left Scalar, Right Scalar) fails never -> Scalar { return Right }
        func -() fails never -> Scalar { return Scalar }
        func <(Right Self) fails never -> boolean { return yes }
      }
      type Delta is numeric
      type Child is Scalar
      func Add(Left Child, Right Delta) -> Scalar { return Left + Right }
      func Same(Left Child, Right Scalar) -> Scalar { return Left + Right }
      func Negate(Value Child) -> Scalar { return -Value }
      func Less(Left Child, Right Child) -> boolean { return Left < Right }
    `)
    const left = TR.Value(5)
    const right = TR.Value(9)
    Expect(TR.Call(scope['Add'], left, right).evaluate() === left).toBe(true)
    Expect(TR.Call(scope['Same'], left, right).evaluate() === right).toBe(true)
    Expect(TR.Call(scope['Negate'], left).evaluate() === left).toBe(true)
    Expect(TR.Call(scope['Less'], right, left).getJSValue()).toBe(true)
  })
})
