import { Describe, Expect, Test } from '@shared/test'
import { AST } from '../parser-src/parser'
import { testParseCode } from './test-parse'

Describe('parser: test world controls', () => {
  Test('keeps network, sync, and named datasource failure in journey order', async () => {
    const result = await testParseCode(`
      app Demo { view Main }
      view Main() { }
      test "Demo" { test "offline write" {
        run Demo
        network offline
        datasource fails after create Note "rejected"
        network online
        wait for sync
      } }
    `)
    const suite = result.entry.ast.statements.find(AST.isTestDeclaration)
    const check = suite?.block.statements.find(AST.isTestDeclaration)
    Expect.Is(check, AST.isTestDeclaration)
    Expect(check.block.statements.filter(AST.isCheckStep).map(step => step.$type)).toEqual([
      AST.RunStep.$type,
      AST.NetworkTestStep.$type,
      AST.DatasourceFailureStep.$type,
      AST.NetworkTestStep.$type,
      AST.WaitForSyncStep.$type,
    ])
  })
})
