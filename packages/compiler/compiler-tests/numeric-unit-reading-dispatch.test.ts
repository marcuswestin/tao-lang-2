import { Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import TR from '../../apps/runtime/TaoRuntime-src/TR'
import { makeQuantityType } from '../../apps/runtime/TaoRuntime-src/TR-quantity-values'
import { withQuantityFactoryBindings } from '../compiler-src/codegen/react-native/app/NumericUnitsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

async function emit(body: string) {
  const parsed = await Parser.parseCode(
    `
    type Span is numeric with { units { seconds 1 (default), minutes 60 } }
    type Child is Span
    ${body}
  `,
    { validation: false },
  )
  Expect(parsed.diagnostics).toEqual([])
  const child = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Child')
  Expect.Is(child, AST.isTypeDeclaration)
  const fn = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
  Expect.Is(fn, AST.isFunctionDeclaration)
  const value = AST.returnStatementsOf(fn)[0]?.value
  Expect.Is(value, AST.isMethodCallExpression)
  const type = Type.ofExpression(value)
  Expect(Type.quantityOwner(type) === child).toBe(true)
  return withQuantityFactoryBindings(
    new Map([[child, 'ChildFactory']]),
    () => Langium.toString(Compile.Expression(value)),
  )
}

Describe('compiler: generated unit reading dispatch', () => {
  Test('emits the checked concrete factory before ordinary associated lookup', async () => {
    const code = await emit('func Read(Value Child) -> Child { return Value.seconds() }')
    Expect(code).toBe('ChildFactory.inUnit(TR.Alias(() => _Scope.Value.evaluate()), "seconds")')
  })

  Test('emits real reading chains with one original receiver occurrence', async () => {
    const code = await emit('func Read(Value Child) -> Child { return Value.seconds().minutes() }')
    Expect(code).toContain('ChildFactory.inUnit(TR.Readonly(TR.Alias(() => ChildFactory.inUnit(')
    Expect(code.match(/_Scope\.Value/g)).toHaveLength(1)
    Expect(code.match(/ChildFactory\.inUnit/g)).toHaveLength(2)
    Expect(code).toContain('"seconds"')
    Expect(code).toContain('"minutes"')
  })

  Test('executes the actual emitted chain once and retains checked descendant backing', async () => {
    const code = await emit('func Read(Value Child) -> Child { return Value.seconds().minutes() }')
    let invariantCalls = 0
    const parent = makeQuantityType(
      {
        domain: 'Span',
        defaultUnit: 'seconds',
        units: { seconds: 1, minutes: 60 },
        invariant: () => {
          invariantCalls++
          return true
        },
      } as const,
      TR.Value,
    )
    const child = parent.derive({ domain: 'Child' })
    const input = child.fromUnit(2, 'minutes')
    const before = invariantCalls
    let reads = 0
    const scope = {
      Value: {
        evaluate: () => {
          reads++
          return input
        },
      },
    }
    const output = new Function('TR', '_Scope', 'ChildFactory', `return ${code}`)(TR, scope, child) as ReturnType<
      typeof child.fromJSValue
    >
    Expect(reads).toBe(1)
    Expect(child.ownsPayload(output.jsValue)).toBe(true)
    Expect(child.read(output)).toEqual({ canonical: 120, unit: 'minutes' })
    Expect(invariantCalls).toBe(before)
  })

  Test('retains real member-path receiver emission', async () => {
    const code = await emit('func Read(Box { Span Child }) -> Child { return Box.Span.seconds() }')
    Expect(code).toContain('ChildFactory.inUnit(TR.Member(TR.Alias(() => _Scope.Box.evaluate()), ["Span"])')
    Expect(code.match(/_Scope\.Box/g)).toHaveLength(1)
  })
})
