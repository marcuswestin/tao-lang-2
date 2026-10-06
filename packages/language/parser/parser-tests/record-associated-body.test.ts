import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: record associated body', () => {
  Test('retains original fields and the actual declaration owner of trailing methods and views', async () => {
    const parsed = await testParseSyntax(`
      type Row is { Label text } with {
        func Caption() fails never -> text { return "Caption" }
        view Render() { render "Row" }
      }
    `)
    const row = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(row, AST.isTypeDeclaration)
    Expect.Is(row.type, AST.isItemTypeExpression)
    Expect(row.type.properties.map(property => property.name)).toEqual(['Label'])
    const method = row.associated?.methods[0]
    const view = row.associated?.views[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    Expect(AST.associatedFunctionOwner(method)).toBe(row)
    Expect(AST.associatedViewOwner(view)).toBe(row)
  })
})
