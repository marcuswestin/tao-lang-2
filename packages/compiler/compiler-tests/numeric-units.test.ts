import { NumericUnits, Type } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Validator from '@validator'
import {
  checkedNumericValue,
  quantityFactoryBinding,
  withQuantityFactoryBindings,
} from '../compiler-src/codegen/react-native/app/NumericUnitsCompiler'
import { gen } from '../compiler-src/codegen/react-native/codegen-util'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const declaration = `
  type Measure is numeric with {
    units { Seconds 1 (default), Minutes 60, Milliseconds 0.001 }
  }
`
const validatorSession = Validator.createSession()
// Runtime execution belongs to Bun's TSX loader; the compiler package itself does not compile UI.
const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))
const quantityModule = import(
  FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-quantity-values.ts', Repo.getRoot())
)

async function validated(source: string): Promise<AST.TaoFile> {
  const result = await (await validatorSession).validateCode(source)
  Expect(Diagnostics.errorMessages(result.diagnostics)).toEqual([])
  return result.entry.ast
}

function quantityOwner(file: AST.TaoFile, name = 'Measure'): AST.TypeDeclaration {
  const owner = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === name)
  Expect.Is(owner, AST.isTypeDeclaration)
  Expect(NumericUnits.declarationPlan(owner)).toBeDefined()
  return owner
}

function aliasValue(file: AST.TaoFile, name: string): AST.Expression {
  const alias = file.statements.find(statement => AST.isAliasDeclaration(statement) && statement.name === name)
  Expect.Is(alias, AST.isAliasDeclaration)
  return alias.value
}

function expressionCode(expression: AST.Expression, owner: AST.TypeDeclaration): string {
  return withQuantityFactoryBindings(
    new Map([[owner, 'Factory']]),
    () => Langium.toString(Compile.Expression(expression)),
  )
}

async function factory() {
  const [{ default: TR }, { makeQuantityType }] = await Promise.all([runtimeModule, quantityModule])
  return makeQuantityType(
    {
      domain: 'Measure',
      defaultUnit: 'Seconds',
      units: { Seconds: 1, Minutes: 60, Milliseconds: 0.001 },
    } as const,
    TR.Value,
  )
}

async function executeExpression(code: string, ownerFactory: Awaited<ReturnType<typeof factory>>, scope: object = {}) {
  const { default: TR } = await runtimeModule
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`return ${code}`)
  return new Function('TR', 'Factory', '_Scope', javascript)(TR, ownerFactory, scope)
}

Describe('compiler: numeric units', () => {
  Test('checks direct and nominal numeric wrapper admission once without replacing the wrapper', async () => {
    const file = await validated('type Storage is numeric let Direct = Storage 2')
    const storage = file.statements.find(AST.isTypeDeclaration)
    Expect.Is(storage, AST.isTypeDeclaration)
    const { default: TR } = await runtimeModule
    const direct = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      `return ${Langium.toString(Compile.Expression(aliasValue(file, 'Direct')))}`,
    )
    Expect(new Function('TR', direct)(TR).jsValue).toBe(2)
    for (const target of [Type.ofDefinition(storage), { kind: 'primitive', primitive: 'numeric' }] as const) {
      const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
        `return ${Langium.toString(checkedNumericValue(gen`Provide()`, target))}`,
      )
      const invoke = new Function('TR', 'Provide', code)
      for (const input of [2, -0, Number.MAX_VALUE, NaN, Infinity, -Infinity, '2', null]) {
        let calls = 0
        const wrapped = TR.Value(input)
        const provide = () => {
          calls++
          return wrapped
        }
        if (typeof input === 'number' && Number.isFinite(input)) {
          Expect(invoke(TR, provide)).toBe(wrapped)
        } else {
          let failure: unknown
          try {
            invoke(TR, provide)
          } catch (error) {
            failure = error
          }
          Expect(failure).toHaveProperty(
            'caseName',
            typeof input === 'number' ? 'QuantityNonFinite' : 'QuantityBadShape',
          )
        }
        Expect(calls).toBe(1)
      }
    }
  })

  Test('checks raw native numeric return backing before wrapping and invokes native once', async () => {
    for (const target of ['numeric', 'Storage']) {
      const file = await validated(`type Storage is numeric
        function Make() returns ${target} { return Make() from ./Make.ts }
      `)
      const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
      Expect.Is(bridge, AST.isFromExpression)
      const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
        `return ${Langium.toString(Compile.Expression(bridge))}`,
      )
      const invoke = new Function('TR', '__tao_bridge_1__', code)
      const { default: TR } = await runtimeModule
      for (const input of [2, -0, NaN, Infinity, -Infinity, '2', null]) {
        let calls = 0
        const native = () => {
          calls++
          return input
        }
        if (typeof input === 'number' && Number.isFinite(input)) {
          Expect(Object.is(invoke(TR, native).jsValue, input)).toBe(true)
        } else {
          let failure: unknown
          try {
            invoke(TR, native)
          } catch (error) {
            failure = error
          }
          Expect(failure).toHaveProperty(
            'caseName',
            typeof input === 'number' ? 'QuantityNonFinite' : 'QuantityBadShape',
          )
        }
        Expect(calls).toBe(1)
      }
    }
  })

  Test('retains a present optional quantity wrapper and passes native absence as null', async () => {
    const file = await validated(`${declaration}
      function Inspect(Value Measure?) returns text { return Inspect(Value) from ./Inspect.ts }
    `)
    const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
    Expect.Is(bridge, AST.isFromExpression)
    const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      `return ${expressionCode(bridge, quantityOwner(file))}`,
    )
    const invoke = new Function('TR', '_Scope', '__tao_bridge_1__', code)
    const { default: TR } = await runtimeModule
    const ownerFactory = await factory()
    const present = ownerFactory.fromUnit(2, 'Minutes')
    for (const input of [present, TR.Value(null)]) {
      let calls = 0
      let received: unknown
      invoke(TR, { Value: input }, (value: unknown) => {
        calls++
        received = value
        return 'ok'
      })
      Expect(calls).toBe(1)
      Expect(received).toBe(input === present ? present : null)
      if (received === present) {
        Expect(ownerFactory.read(present)).toEqual({ canonical: 120, unit: 'Minutes' })
      }
    }
  })

  Test('preserves either canonical owner wrapper through a quantity-only native union', async () => {
    const file = await validated(`${declaration}
      type Other is numeric with { units { Items 1 (default) } }
      type Choice is Measure | Other
      function Inspect(Value Choice) returns text { return Inspect(Value) from ./Inspect.ts }
    `)
    const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
    Expect.Is(bridge, AST.isFromExpression)
    const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      `return ${expressionCode(bridge, quantityOwner(file))}`,
    )
    const invoke = new Function('TR', '_Scope', '__tao_bridge_1__', code)
    const { default: TR } = await runtimeModule
    const { makeQuantityType } = await quantityModule
    const first = await factory()
    const second = makeQuantityType({ domain: 'Other', units: { Items: 1 }, defaultUnit: 'Items' }, TR.Value)
    for (
      const [input, owner, canonical] of [
        [first.fromUnit(2, 'Minutes'), first, 120],
        [second.fromUnit(3, 'Items'), second, 3],
      ] as const
    ) {
      let received: unknown
      invoke(TR, { Value: input }, (value: unknown) => {
        received = value
        return 'ok'
      })
      Expect(received).toBe(input)
      Expect(owner.read(received as never).canonical).toBe(canonical)
    }
  })

  Test('preserves quantity wrappers and unwraps data through a mixed native union once', async () => {
    const file = await validated(`${declaration}
      type Choice is Measure | number
      function Inspect(Value Choice) returns text { return Inspect(Value) from ./Inspect.ts }
    `)
    const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
    Expect.Is(bridge, AST.isFromExpression)
    const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      `return ${expressionCode(bridge, quantityOwner(file))}`,
    )
    const invoke = new Function('TR', '_Scope', '__tao_bridge_1__', code)
    const { default: TR } = await runtimeModule
    const ownerFactory = await factory()
    const quantity = ownerFactory.fromUnit(2, 'Minutes')
    for (const input of [quantity, TR.Value(7)]) {
      let evaluations = 0
      let calls = 0
      let received: unknown
      invoke(TR, {
        Value: {
          evaluate: () => {
            evaluations++
            return input
          },
        },
      }, (value: unknown) => {
        calls++
        received = value
        return 'ok'
      })
      Expect(evaluations).toBe(1)
      Expect(calls).toBe(1)
      Expect(received).toBe(input === quantity ? quantity : 7)
      if (received === quantity) {
        Expect(ownerFactory.read(quantity)).toEqual({ canonical: 120, unit: 'Minutes' })
      }
    }
  })

  Test('checks a native quantity result once and retains its wrapper and selected unit', async () => {
    const file = await validated(`${declaration}
      function Make() returns Measure { return Make() from ./Make.ts }
    `)
    const owner = quantityOwner(file)
    const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
    Expect.Is(bridge, AST.isFromExpression)
    const code = expressionCode(bridge, owner)
    Expect(code).toContain('Factory.read(result)')
    Expect(code).not.toContain('TR.Value(')
    Expect(code).not.toContain('fromJSValue')
    const { default: TR } = await runtimeModule
    const ownerFactory = await factory()
    const returned = ownerFactory.fromUnit(2, 'Minutes')
    let calls = 0
    const native = () => {
      calls += 1
      return returned
    }
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`return ${code}`)
    const invoke = new Function('TR', 'Factory', '__tao_bridge_1__', javascript)
    const result = invoke(TR, ownerFactory, native)
    Expect(calls).toBe(1)
    Expect(result).toBe(returned)
    Expect(ownerFactory.read(result)).toEqual({ canonical: 120, unit: 'Minutes' })
    const otherFactory = await factory()
    Expect(() => invoke(TR, ownerFactory, () => otherFactory.fromUnit(2, 'Minutes'))).toThrow()
    Expect(() => invoke(TR, ownerFactory, () => TR.Value(120))).toThrow()
  })

  Test('constructs signed, grouped and qualified units through the supplied owner factory', async () => {
    const file = await validated(`${declaration}
      let Signed = -2 Minutes
      let Grouped = (-2) Minutes
      let Qualified = 1500 Measure.Milliseconds
      let Calculated = (1 + 2) Minutes
    `)
    const owner = quantityOwner(file)
    const ownerFactory = await factory()
    for (
      const [name, canonical, unit] of [
        ['Signed', -120, 'Minutes'],
        ['Grouped', -120, 'Minutes'],
        ['Qualified', 1.5, 'Milliseconds'],
        ['Calculated', 180, 'Minutes'],
      ] as const
    ) {
      const code = expressionCode(aliasValue(file, name), owner)
      Expect(code).toContain('Factory.fromUnit(')
      Expect(code).not.toContain('makeQuantityType')
      Expect(ownerFactory.read(await executeExpression(code, ownerFactory))).toEqual({ canonical, unit })
    }
  })

  Test('requires a canonical owner binding and releases the scope after nesting and emission failure', async () => {
    const file = await validated(`${declaration} let Value = 2 Minutes`)
    const owner = quantityOwner(file)
    const expression = aliasValue(file, 'Value')
    Expect(() => Compile.Expression(expression)).toThrow('quantity factory bindings are scoped')
    Expect(() => withQuantityFactoryBindings(new Map(), () => Compile.Expression(expression)))
      .toThrow('a quantity owner has a planned factory binding')
    withQuantityFactoryBindings(new Map([[owner, 'First']]), () => {
      Expect(() => withQuantityFactoryBindings(new Map([[owner, 'Second']]), () => undefined))
        .toThrow('quantity factory bindings are not nested')
      Expect(quantityFactoryBinding(owner)).toBe('First')
    })
    Expect(() => quantityFactoryBinding(owner)).toThrow('quantity factory bindings are scoped')
    Expect(() => withQuantityFactoryBindings(new Map([[owner, 'First']]), () => quantityFactoryBinding({} as never)))
      .toThrow('a quantity owner has a planned factory binding')
    Expect(expressionCode(expression, owner)).toContain('Factory.fromUnit(')
  })

  Test('preserves generated quantity values through an ordinary function and mutable cell', async () => {
    const file = await validated(`${declaration}
      function Pass(Value Measure) returns Measure { return Value }
      let Initial = 2 Minutes
      let Through = Pass(Initial)
    `)
    const owner = quantityOwner(file)
    const { default: TR } = await runtimeModule
    const ownerFactory = await factory()
    const initial = await executeExpression(expressionCode(aliasValue(file, 'Initial'), owner), ownerFactory)
    const fn = file.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    const generated = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      Langium.toString(Compile.FunctionDeclaration(fn)),
    )
    const scope = { Initial: TR.Cell(initial) }
    new Function('TR', '_Scope', generated)(TR, scope)
    const through = await executeExpression(expressionCode(aliasValue(file, 'Through'), owner), ownerFactory, scope)
    Expect(ownerFactory.read(through)).toEqual({ canonical: 120, unit: 'Minutes' })
    Expect(through.jsValue).toBe(scope.Initial.evaluate().jsValue)
  })

  Test('passes quantity wrappers and ordinary JavaScript data to a native call', async () => {
    const file = await validated(`${declaration}
      function Inspect(Value Measure, Label text) returns text {
        return Inspect(Value, Label) from ./Inspect.ts
      }
    `)
    const owner = quantityOwner(file)
    const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
    Expect.Is(bridge, AST.isFromExpression)
    const code = expressionCode(bridge, owner)
    Expect(code).toContain('_Scope.Value.evaluate()')
    Expect(code).not.toContain('_Scope.Value.evaluate().jsValue')
    Expect(code).toContain('_Scope.Label.evaluate().jsValue')
    const { default: TR } = await runtimeModule
    const ownerFactory = await factory()
    const input = ownerFactory.fromUnit(2, 'Minutes')
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`return ${code}`)
    let received: unknown[] = []
    const native = (...args: unknown[]) => {
      received = args
      return 'inspected'
    }
    const result = new Function('TR', '_Scope', '__tao_bridge_1__', javascript)(
      TR,
      { Value: input, Label: TR.Value('minutes') },
      native,
    )
    Expect(received).toEqual([input, 'minutes'])
    Expect(received[0]).toBe(input)
    Expect(result.jsValue).toBe('inspected')
  })
})
