import { Packages } from '@ast-utils'
import { Describe, Expect, Test } from '@shared/test'

import { LSPWorkspace, Workspace } from '@compiler/workspace'
import { AST, Langium, Parser } from '@parser'
import { testParseCode } from './test-parse'

Describe('parser package API', () => {
  // REMOVAL CANDIDATE: Static imports and feature suites exercise most exports; review the public API obligation before deleting this smoke.
  Test('exports parser, AST, Langium, package, and workspace entrypoints', async () => {
    Expect(Parser.lexCode('app MyApp { view MainView } view MainView() { }').errors).toEqual([])

    const parseResult = await testParseCode('app MyApp { view MainView } view MainView() { }')

    const app = parseResult.entry.ast.statements[0]
    const view = parseResult.entry.ast.statements[1]
    Expect(AST.isAppDeclaration(app)).toBe(true)
    Expect(AST.isViewDeclaration(view)).toBe(true)
    const viewDeclaration = view as AST.ViewDeclaration
    Expect(AST.findRoot(parseResult.entry.ast)).toBe(parseResult.entry.ast)
    Expect(AST.parametersOf(viewDeclaration)).toEqual([])
    Expect(AST.blockStatementOf(viewDeclaration, { filter: () => true })).toEqual([])
    Expect(AST.isEmittingRuntimeBinding(viewDeclaration)).toBe(true)
    Expect(typeof Langium.URI.file).toBe('function')
    Expect(Packages.isStdLibImport('@tao/ui')).toBe(true)
    Expect(LSPWorkspace).toBeDefined()
    Expect(Workspace).toBeDefined()
  })
})
