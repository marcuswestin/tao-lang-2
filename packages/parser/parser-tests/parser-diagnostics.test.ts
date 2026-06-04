import { describe, expect, test } from 'bun:test'
import { testParseCode, testParseCodeWithLexerErrors, testParseCodeWithParserErrors } from './test-parse'

describe('minimal Tao parser diagnostics', () => {
  test('parses compact source without newlines', async () => {
    const parsed = await testParseCode('app MyApp { ui MyView } ui MyView { }')

    expect(parsed.ast.statements).toHaveLength(2)
  })

  test('reports parser errors for unknown declaration keywords', async () => {
    const parsed = await testParseCodeWithParserErrors('view Legacy { }')

    expect(parsed.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
  })

  test('parses top-level statements for later validator checks', async () => {
    const parsed = await testParseCode('inject ```ts\nreturn null\n```')

    expect(parsed.ast.statements).toHaveLength(1)
  })

  test('reports parser errors for incomplete render statements', async () => {
    const parsed = await testParseCodeWithParserErrors('ui Broken { render }')

    expect(parsed.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
  })

  test('parses nested declarations for later validator checks', async () => {
    const parsed = await testParseCode('app MyApp { ui MyView } ui MyView { ui Nested { } }')

    expect(parsed.ast.statements).toHaveLength(2)
  })

  test('reports lexer errors separately from parser errors', async () => {
    const parsed = await testParseCodeWithLexerErrors('app MyApp { ui MyView } @ ui MyView { }')

    expect(parsed.document.parseResult.lexerErrors.length).toBeGreaterThan(0)
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
  })
})
