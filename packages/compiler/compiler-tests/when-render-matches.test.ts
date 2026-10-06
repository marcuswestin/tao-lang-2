import { AST, Langium, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

Describe('compiler: render when matches', () => {
  Test('emits missing fallback for ordinary and availability subjects without reading an absent block', async () => {
    const parsed = await Parser.parseCode(
      `
      data Documents / Document { Title text }
      view Plain(Value boolean) { when Value { true -> { } } }
      view Available(Value Document) { when Value { error Message -> { } } }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const statements = [...AST.streamAllContents(parsed.entry.ast)].filter(AST.isWhenRenderStatement)
    Expect(statements).toHaveLength(2)
    Expect(statements.every(statement => statement.otherwise === undefined)).toBe(true)
    const emitted = statements.map(statement => Langium.toString(Compile.WhenRenderStatement(statement)))
    Expect(emitted[0]).toContain('TR.WhenAllRender(')
    Expect(emitted[0]).toContain('], undefined)')
    Expect(emitted[1]).toContain('TR.WhenReadRender(')
    Expect(emitted[1]).toContain('], undefined, _ViewProps.__tao)')
  })

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
