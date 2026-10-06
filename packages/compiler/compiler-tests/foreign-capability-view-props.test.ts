import { AST, Langium, Parser } from '@parser'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: foreign capability view props', () => {
  for (
    const { generic, list } of [{ generic: false, list: false }, { generic: true, list: false }, {
      generic: true,
      list: true,
    }]
  ) {
    Test(
      `${generic ? 'generic' : 'ordinary'} native ${
        list ? 'list' : 'value'
      } retains authenticated carriers and samples text`,
      async () => {
        const parsed = await Parser.parseCode(
          `
        can Display { ToText() fails never -> text }
        view Sink ${generic ? 'where type T is Display' : ''}(Value ${list ? 'list of ' : ''}${
            generic ? 'T' : 'Display'
          }, Label text)
          from ./Sink.tsx
      `,
          { validation: false },
        )
        Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
        Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
        const view = parsed.entry.ast.statements.find(AST.isViewDeclaration)!
        const code = Langium.toString(Compile.ViewDeclaration(view))
        const value = code.match(/\bValue=\{([^}]+)\}/)?.[1]
        const label = code.match(/\bLabel=\{([^}]+)\}/)?.[1]
        Assert(value && label, 'the actual native view receives Value and Label props')
        const { default: TR } = await runtimeModule
        const original = TR.Cell(TR.Value('before'))
        const carrier = TR.Capability.attach(original, {
          ToText: TR.Function((receiver: any) => {
            Expect(receiver === original).toBe(true)
            return TR.Value(receiver.getJSValue())
          }),
        })
        const scope = { Value: TR.Alias(() => list ? TR.Value([carrier]) : carrier), Label: TR.Value('caption') }
        const received = new Function('_Scope', `return { Value: ${value}, Label: ${label} }`)(scope)
        const receivedCarrier = list ? received.Value[0] : received.Value
        Expect(receivedCarrier === carrier).toBe(true)
        Expect(received.Label).toBe('caption')
        const held = TR.Capability.method(receivedCarrier, 'ToText')
        original.set(TR.Value('after'))
        Expect(TR.Call(held).getJSValue()).toBe('after')
      },
    )
  }
})
