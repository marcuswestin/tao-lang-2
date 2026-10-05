import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { resolveNumericUnitReading } from '../../language/ast-utils/ast-utils-src/numeric-unit-readings'
import {
  compileNumericUnitReading,
  withQuantityFactoryBindings,
} from '../compiler-src/codegen/react-native/app/NumericUnitsCompiler'
import { type Compiled, gen } from '../compiler-src/codegen/react-native/codegen-util'
import { TestCompiler } from './test-compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))
const quantityModule = import(
  FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-quantity-values.ts', Repo.getRoot())
)

async function emitted(ownerName: string, unit: string, receiver: Compiled = gen`Provide()`) {
  const parsed = await Parser.parseCode(
    `
    type Span is numeric with { units { seconds 1 (default), minutes 60 } }
    type Child is Span
    func Read(Value ${ownerName}) -> ${ownerName} { return Value.${unit}() }
  `,
    { validation: false },
  )
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  const call = AST.streamAllContents(parsed.entry.ast).find(AST.isMethodCallExpression)
  Expect.Is(call, AST.isMethodCallExpression)
  const resolution = resolveNumericUnitReading(call)
  Expect(resolution.kind).toBe('unit-reading')
  if (resolution.kind !== 'unit-reading') {
    return ''
  }
  return withQuantityFactoryBindings(
    new Map([[resolution.reading.concreteFactoryOwner, 'Factory']]),
    () => Langium.toString(compileNumericUnitReading(resolution.reading, receiver)),
  )
}

async function factories() {
  const [{ default: TR }, { makeQuantityType }] = await Promise.all([runtimeModule, quantityModule])
  let invariants = 0
  const parent = makeQuantityType(
    {
      domain: 'Span',
      defaultUnit: 'seconds',
      units: { seconds: 1, minutes: 60 },
      invariant: () => {
        invariants++
        return true
      },
    } as const,
    TR.Value,
  )
  const child = parent.derive({ domain: 'Child' })
  return { TR, parent, child, invariantCalls: () => invariants }
}

function execute(code: string, factory: unknown, provide: () => unknown): unknown {
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`return ${code}`)
  return new Function('Factory', 'Provide', javascript)(factory, provide)
}

Describe('compiler: numeric unit reading emission', () => {
  Test('plans a whole app with an associated call chained after a declared unit reading', async () => {
    const result = await TestCompiler.compileCode(`
      type Span is numeric with {
        units { seconds 1 (default), minutes 60 }
        func ToText() fails never -> text { return "reading" }
      }
      app Sample { id "unit.reading.chain" name "Units" version "1.0.0" view Main }
      view Main {
        let Span = 2 minutes
        let Caption = Span.seconds().ToText()
        render Caption
      }
    `)
    Expect(result.code).toContain('.inUnit(')
    Expect(result.code).toContain('["ToText"]')
    Expect(result.code).toContain('TR.RenderText(')
  })

  Test('reads once, retains canonical backing and concrete descendant proof without rerunning invariants', async () => {
    const f = await factories()
    const input = f.child.fromUnit(2, 'minutes')
    const before = f.invariantCalls()
    for (const owner of ['Span', 'Child']) {
      let calls = 0
      const code = await emitted(owner, 'seconds')
      Expect(code).toBe('Factory.inUnit(Provide(), "seconds")')
      const output = execute(code, owner === 'Span' ? f.parent : f.child, () => {
        calls++
        return input
      }) as ReturnType<typeof f.child.fromJSValue>
      Expect(calls).toBe(1)
      Expect(f.child.ownsPayload(output.jsValue)).toBe(true)
      Expect(f.parent.read(output)).toEqual({ canonical: 120, unit: 'seconds' })
      Expect(f.invariantCalls()).toBe(before)
    }
  })

  Test('chained emitted views preserve magnitude instead of renormalizing it', async () => {
    const f = await factories()
    const input = f.child.fromUnit(2, 'minutes')
    const first = await emitted('Child', 'seconds')
    const code = await emitted('Child', 'minutes', gen`${first}`)
    let calls = 0
    const output = execute(code, f.child, () => {
      calls++
      return input
    }) as ReturnType<typeof f.child.fromJSValue>
    Expect(calls).toBe(1)
    Expect(f.child.read(output)).toEqual({ canonical: 120, unit: 'minutes' })
    Expect(f.child.ownsPayload(output.jsValue)).toBe(true)
    Expect(input.jsValue.unit).toBe('minutes')
  })

  Test('emitted checked calls reject foreign and forged receiver payloads', async () => {
    const f = await factories()
    const { makeQuantityType } = await quantityModule
    const foreign = makeQuantityType(
      {
        domain: 'Span',
        defaultUnit: 'seconds',
        units: { seconds: 1, minutes: 60 },
      } as const,
      f.TR.Value,
    )
    const code = await emitted('Span', 'seconds')
    for (
      const [input, expected] of [
        [foreign.fromUnit(2, 'minutes'), 'QuantityDomainMismatch'],
        [f.TR.Value({ domain: 'Span', canonical: 120, unit: 'minutes' }), 'QuantityBadShape'],
      ] as const
    ) {
      let failure: unknown
      try {
        execute(code, f.parent, () => input)
      } catch (error) {
        failure = error
      }
      Expect(failure).toHaveProperty('caseName', expected)
    }
  })
})
