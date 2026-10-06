import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: source action results', () => {
  Test('parses the Syntax2 source action body with existing alias and return nodes', async () => {
    const parsed = await testParseSyntax(`
      type TemporaryFile is text
      type Timer is { func Duration() -> number { return 5 } }
      action CreateTemporaryPDF(Book text) -> TemporaryFile from ./BookIO.ts
      action DeleteTemporaryFile(File TemporaryFile) from ./BookIO.ts
      action UploadFile(File TemporaryFile) from ./BookIO.ts
      action Export(Book text) {
        let Timer = StartTimer()
        let File = do CreateTemporaryPDF(Book)
        defer DeleteTemporaryFile(File)
        do UploadFile(File)
        return Timer.Duration()
      }
    `)
    const exportAction = AST.streamAllContents(parsed.entry.ast).find(
      node => AST.isActionDeclaration(node) && node.name === 'Export',
    )
    Expect.Is(exportAction, AST.isActionDeclaration)
    Expect(exportAction.returnType).toBeUndefined()
    Expect.Is(exportAction.block?.statements[0], AST.isAliasDeclaration)
    Expect.Is(exportAction.block?.statements[1], AST.isActionResultStatement)
    Expect.Is(exportAction.block?.statements[2], AST.isDeferStatement)
    Expect.Is(exportAction.block?.statements[3], AST.isDoStatement)
    const returned = exportAction.block?.statements[4]
    Expect.Is(returned, AST.isReturnStatement)
    Expect.Is(returned.value, AST.isMethodCallExpression)
    Expect.Is(returned.value.callee, AST.isMemberAccessExpression)
    Expect(returned.value.callee.members).toEqual(['Duration'])
    const creation = AST.streamAllContents(parsed.entry.ast).find(
      node => AST.isActionDeclaration(node) && node.name === 'CreateTemporaryPDF',
    )
    Expect.Is(creation, AST.isActionDeclaration)
    Expect(creation.returnType).toBeDefined()
  })

  Test('keeps legacy `returns` and canonical `->` action annotations on one field', async () => {
    const parsed = await testParseCode(`
      action Legacy() returns text from ./Bindings.ts
      action Canonical() -> text from ./Bindings.ts
    `)
    const actions = parsed.entry.ast.statements.filter(AST.isActionDeclaration)
    Expect(actions.map(action => action.returnType?.$type)).toEqual([
      'PrimitiveTypeReference',
      'PrimitiveTypeReference',
    ])
  })
})
