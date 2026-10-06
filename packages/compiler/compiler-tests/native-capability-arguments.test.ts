import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, fence, Test, tsFence } from '@shared/test'
import { bridgeBindingName, inlineInjectionBindingName } from '../compiler-src/codegen/react-native/app/injection-plan'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: native capability arguments', () => {
  for (const boundary of ['inline', 'sidecar'] as const) {
    Test(`${boundary} retains the authenticated carrier and samples ordinary text`, async () => {
      const source = boundary === 'inline'
        ? `view Sink(Value Display, Label text) { render inject Value, Label ${tsFence} return null ${fence} }`
        : `func Sink(Value Display, Label text) -> text { return Sink(Value, Label) from ./Native.ts }`
      const parsed = await Parser.parseCode(`can Display { ToText() -> text }\n${source}`, { validation: false })
      Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
      const nodes = [...AST.streamAllContents(parsed.entry.ast)]
      const { default: TR } = await runtimeModule
      const cell = TR.Cell(TR.Value('Before'))
      const carrier = TR.Capability.attach(cell, {
        ToText: TR.Function((receiver: any) => {
          Expect(receiver === cell).toBe(true)
          return TR.Value(`Token:${receiver.getJSValue()}`)
        }),
      })
      let held: ReturnType<typeof TR.Capability.method> | undefined
      const native = (value: typeof carrier, label: string) => {
        Expect(value === carrier).toBe(true)
        Expect(label).toBe('ordinary text')
        held = TR.Capability.method(value, 'ToText')
        return 'accepted'
      }
      const scope = { Value: TR.Alias(() => carrier), Label: TR.Value('ordinary text') }
      if (boundary === 'inline') {
        const injection = nodes.find(AST.isInjection)
        Expect.Is(injection, AST.isInjection)
        const code = Langium.toString(Compile.Injection(injection))
        const result = new Function('TR', '_Scope', inlineInjectionBindingName(injection), `return ${code}`)(
          TR,
          scope,
          native,
        )
        Expect(result).toBe('accepted')
        Expect(Langium.toString(Compile.InjectionBoundary(injection))).toContain('Value: TR.Capability')
      } else {
        const bridge = nodes.find(AST.isFromExpression)
        Expect.Is(bridge, AST.isFromExpression)
        const code = Langium.toString(Compile.FromExpression(bridge))
        const result = new Function('TR', '_Scope', bridgeBindingName(bridge), `return ${code}`)(TR, scope, native)
        Expect(result.getJSValue()).toBe('accepted')
      }
      Expect.Is(held, (value): value is NonNullable<typeof held> => value !== undefined)
      Expect(TR.Call(held).getJSValue()).toBe('Token:Before')
      cell.set(TR.Value('After'))
      Expect(TR.Call(held).getJSValue()).toBe('Token:After')
    })
  }
})
