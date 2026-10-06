import { NumericUnits } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { bridgeBindingName } from '../compiler-src/codegen/react-native/app/injection-plan'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))
const quantityModule = import(
  FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-quantity-values.ts', Repo.getRoot())
)
const declarations = `
  abstract type Scalar is numeric
  type Duration is Scalar with { units { seconds 1 (default), minutes 60 } }
`

Describe('compiler: abstract native numeric bridges', () => {
  Test('preserves an authentic concrete wrapper at direct and optional abstract argument boundaries', async () => {
    const parsed = await Parser.parseCode(
      `${declarations}
      func Direct(Value Scalar) -> boolean { return Direct(Value) from ./Host.ts }
      func Optional(Value Scalar?) -> boolean { return Optional(Value) from ./Host.ts }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const owner = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Duration')!
    Expect.Is(owner, AST.isTypeDeclaration)
    const plan = NumericUnits.declarationPlan(owner)!
    const [{ default: TR }, { makeQuantityType }] = await Promise.all([runtimeModule, quantityModule])
    const factory = makeQuantityType({
      domain: owner.name,
      defaultUnit: plan.defaultUnit,
      units: Object.fromEntries(plan.units.map(unit => [unit.name, unit.scale])),
    }, TR.Value)
    const quantity = factory.fromUnit(2, 'minutes')
    Expect(factory.read(quantity)).toEqual({ canonical: 120, unit: 'minutes' })
    const functions = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration)
    Expect(functions.map(declaration => declaration.name)).toEqual(['Direct', 'Optional'])
    for (const declaration of functions) {
      const bridge = AST.returnStatementsOf(declaration)[0]!.value
      Expect.Is(bridge, AST.isFromExpression)
      const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
        `return ${Langium.toString(Compile.Expression(bridge))}`,
      )
      const execute = new Function('TR', '_Scope', bridgeBindingName(bridge), code)
      let received: unknown
      const native = (value: unknown) => {
        received = value
        return true
      }
      Expect(execute(TR, { Value: quantity }, native).getJSValue()).toBe(true)
      Expect(received === quantity).toBe(true)
      if (declaration.name === 'Optional') {
        Expect(execute(TR, { Value: TR.Value(null) }, native).getJSValue()).toBe(true)
        Expect(received).toBe(null)
      }
    }
  })

  Test('refuses abstract numeric native results including union members without inventing a factory', async () => {
    const parsed = await Parser.parseCode(
      `${declarations}
      type Choice is Scalar | number
      func Direct() -> Scalar { return Direct() from ./Host.ts }
      func Mixed() -> Choice { return Mixed() from ./Host.ts }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const functions = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration)
    Expect(functions.map(declaration => declaration.name)).toEqual(['Direct', 'Mixed'])
    for (const declaration of functions) {
      const bridge = AST.returnStatementsOf(declaration)[0]!.value
      Expect.Is(bridge, AST.isFromExpression)
      Expect(() => Compile.Expression(bridge)).toThrow(
        'validated native return has a checked concrete quantity owner contract',
      )
    }
  })
})
