import { AST, Langium, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

Describe('compiler: render when matches', () => {
  Test('lowers subject cases through the multi-match facade', async () => {
    const parsed = await Parser.parseCode(
      `
      view Main(Value boolean) {
        when Value {
          true -> { }
          false -> { }
          otherwise -> { }
        }
      }
    `,
      { validation: false },
    )
    Expect(parsed.diagnostics).toEqual([])
    const statement = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenRenderStatement)
    Expect.Is(statement, AST.isWhenRenderStatement)
    const emitted = Langium.toString(Compile.WhenRenderStatement(statement))
    Expect(emitted).toContain('TR.WhenAllRender(')
    Expect(emitted).not.toContain('TR.WhenCaseRender(')
    Expect(emitted).toContain('"true"')
    Expect(emitted).toContain('"false"')
  })

  Test('captures predicate thunks separately from their render bodies', async () => {
    const parsed = await Parser.parseCode(
      `
      view Main() {
        when | true -> { } | true -> { } | otherwise -> { }
      }
    `,
      { validation: false },
    )
    Expect(parsed.diagnostics).toEqual([])
    const statement = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenRenderStatement)
    Expect.Is(statement, AST.isWhenRenderStatement)
    const emitted = Langium.toString(Compile.WhenRenderStatement(statement))
    Expect(emitted).toContain('TR.WhenPredicatesRender(')
    Expect(emitted.match(/\[\(\) => TR.Value\(true\), \(\) =>/g)).toHaveLength(2)
    Expect(emitted).not.toContain('if (')
  })
})
