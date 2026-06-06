import { Describe, Expect, Test } from '@shared/test'

import { AST, Langium, Parser } from '@parser'
import { testParseCode } from './test-parse'

Describe('parser package API', () => {
  Test('exports Parser, AST, and Langium APIs', async () => {
    Expect(Parser.lexCode('app MyApp { ui MainView } ui MainView { }').errors).toEqual([])

    const parsed = await testParseCode('app MyApp { ui MainView } ui MainView { }')

    Expect(AST.isAppDeclaration(parsed.ast.statements[0])).toBe(true)
    Expect(Langium.URI.file('/tmp/example.tao').path).toBe('/tmp/example.tao')
  })
})
