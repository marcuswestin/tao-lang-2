import { Describe, Expect, Test } from '@shared/test'

import { Packages } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { LSPWorkspace, Workspace } from '@workspace'
import { testParseCode } from './test-parse'

Describe('parser package API', () => {
  Test('exports Parser, AST, Langium, Packages, and Workspace APIs', async () => {
    Expect(Parser.lexCode('app MyApp { ui MainView } ui MainView { }').errors).toEqual([])

    const parseResult = await testParseCode('app MyApp { ui MainView } ui MainView { }')

    Expect(AST.isAppDeclaration(parseResult.entry.ast.statements[0])).toBe(true)
    Expect(Langium.URI.file('/tmp/example.tao').path).toBe('/tmp/example.tao')
    Expect(Packages.isStdLibImport('@tao/ui')).toBe(true)
    Expect(LSPWorkspace).toBeDefined()
    Expect(Workspace).toBeDefined()
  })
})
