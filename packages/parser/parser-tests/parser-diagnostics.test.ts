import { Describe, Expect, Test } from '@shared/test'
import { AST, Parser } from '../parser-src/parser'
import { testParseCode, testParseCodeWithLexerErrors, testParseCodeWithParserErrors } from './test-parse'

Describe('minimal Tao parser diagnostics', () => {
  Test('parses compact source without newlines', async () => {
    const parsed = await testParseCode('app MyApp { ui MyView } ui MyView { }')

    Expect(parsed.ast.statements).toHaveLength(2)
  })

  Test('parses unknown leading identifiers for later validator checks', async () => {
    const parsed = await Parser.parseCode('view Legacy { }')

    Expect(parsed.document.parseResult.parserErrors).toEqual([])
    Expect.Is(parsed.ast.statements[0], AST.isViewRender)
    Expect(parsed.diagnostics.length).toBeGreaterThan(0)
  })

  Test('reports parser errors for incomplete render statements', async () => {
    const parsed = await testParseCodeWithParserErrors('ui Broken { render }')

    Expect(parsed.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(parsed.diagnostics.length).toBeGreaterThan(0)
  })

  Test('parses nested declarations for later validator checks', async () => {
    const parsed = await testParseCode('app MyApp { ui MyView } ui MyView { ui Nested { } }')

    Expect(parsed.ast.statements).toHaveLength(2)
  })

  Test('parses aliases in app blocks for later validator checks', async () => {
    const parsed = await testParseCode('app MyApp { alias Greeting = "hello" ui MyView } ui MyView { }')

    Expect(parsed.ast.statements).toHaveLength(2)
  })

  Test('parses top-level renders for later validator checks', async () => {
    const parsed = await testParseCode('render Text "hello" ui Text Value text { }')

    Expect(parsed.ast.statements).toHaveLength(2)
  })

  Test('parses number-typed parameters in semantically invalid positions', async () => {
    const parsed = await testParseCode(`
      app MyApp { ui MyView }
      ui MyView Count number {
        render Text Count { }
      }
      ui Text Value text { }
    `)

    Expect(parsed.ast.statements).toHaveLength(3)
  })

  Test('reports linker diagnostics for values outside their owning view', async () => {
    const parsed = await Parser.parseCode(`
      ui Text Value text { }
      ui Source Secret text {
        alias Local = Secret
      }
      ui Target {
        render Text Secret { }
        render Text Local { }
      }
    `)

    Expect(parsed.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.document.parseResult.parserErrors).toEqual([])
    Expect(parsed.diagnostics).toHaveLength(2)
  })

  Test('reports lexer errors separately from parser errors', async () => {
    const parsed = await testParseCodeWithLexerErrors('app MyApp { ui MyView } @ ui MyView { }')

    Expect(parsed.document.parseResult.lexerErrors.length).toBeGreaterThan(0)
    Expect(parsed.diagnostics.length).toBeGreaterThan(0)
  })
})
