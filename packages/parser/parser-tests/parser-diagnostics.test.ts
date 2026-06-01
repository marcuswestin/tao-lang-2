import { describe, expect, test } from 'bun:test'
import { parseTaoSource } from '../parser-src/parser'

describe('minimal Tao parser diagnostics', () => {
  test('parses compact source without newlines', async () => {
    const parsed = await parseTaoSource('app MyApp { ui MyView } ui MyView { }')

    expect(parsed.document.parseResult.lexerErrors).toEqual([])
    expect(parsed.document.parseResult.parserErrors).toEqual([])
    expect(parsed.ast.statements).toHaveLength(2)
  })

  test('reports parser errors for unsupported top-level statements', async () => {
    const parsed = await parseTaoSource('view Legacy { }')

    expect(parsed.document.parseResult.lexerErrors).toEqual([])
    expect(parsed.document.parseResult.parserErrors.length).toBeGreaterThan(0)
  })

  test('reports parser errors for incomplete render statements', async () => {
    const parsed = await parseTaoSource('ui Broken { render }')

    expect(parsed.document.parseResult.lexerErrors).toEqual([])
    expect(parsed.document.parseResult.parserErrors.length).toBeGreaterThan(0)
  })

  test('reports lexer errors separately from parser errors', async () => {
    const parsed = await parseTaoSource('ui Broken { render @ }')

    expect(parsed.document.parseResult.lexerErrors.length).toBeGreaterThan(0)
  })
})
