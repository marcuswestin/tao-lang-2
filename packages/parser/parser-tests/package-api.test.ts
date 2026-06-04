import { describe, expect, test } from 'bun:test'

import { AST, Langium, Parser } from '@parser'
import { testParseCode } from './test-parse'

describe('parser package API', () => {
  test('exports Parser, AST, and Langium APIs', async () => {
    expect(Parser.lexCode('app MyApp { ui MainView } ui MainView { }').errors).toEqual([])

    const parsed = await testParseCode('app MyApp { ui MainView } ui MainView { }')

    expect(AST.isAppDeclaration(parsed.ast.statements[0])).toBe(true)
    expect(Langium.URI.file('/tmp/example.tao').path).toBe('/tmp/example.tao')
  })
})
