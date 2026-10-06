import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Type } from '../ast-utils-src/Type'

Describe('Associated entity action receiver domains', () => {
  Test('resolves real single fields and collection receivers without changing the entity family', async () => {
    const parsed = await Parser.parseCode(
      `
      data Books / Book {
        Title text,
        action Book.TitleText() -> text { return Book.Title },
        action Books.Rows() -> Books { return Books }
      }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    Expect(parsed.diagnostics).toEqual([])
    const entity = parsed.entry.ast.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [single, collection] = entity.block.entries.filter(AST.isActionDeclaration)
    Expect.Is(single, AST.isActionDeclaration)
    Expect.Is(collection, AST.isActionDeclaration)
    const fieldPath = returnedValue(single)
    Expect.Is(fieldPath, AST.isMemberAccessExpression)
    const root = Type.ofReferenceRoot(fieldPath)
    Assert(root.kind === 'entity', 'the action field path begins at one entity row')
    Expect(root.entity).toBe(entity)
    Expect(Type.ofExpression(fieldPath)).toEqual({ kind: 'primitive', primitive: 'text' })
    const rowsValue = returnedValue(collection)
    Expect.Is(rowsValue, AST.isValueReference)
    const rows = Type.ofExpression(rowsValue)
    Assert(rows.kind === 'list' && rows.element?.kind === 'entity', 'the collection action sees entity rows')
    Expect(rows.element.entity).toBe(entity)
    const result = Type.ofActionResult(collection)
    Assert(result.kind === 'list' && result.element?.kind === 'entity', 'the written action return preserves rows')
    Expect(result.element.entity).toBe(entity)
    Expect(Type.ofDeclarationFamily(entity)).toEqual({ kind: 'primitive', primitive: 'data' })
  })

  Test('types lexical shadows as their own values and leaves invalid receivers unresolved', async () => {
    const parsed = await Parser.parseCode(
      `
      data Books / Book {
        Title text,
        action Book.Parameter(Book text) { return Book },
        action Books.Local() { let Books = "local" return Books },
        action Wrong.Invalid() { return Wrong }
      }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const entity = parsed.entry.ast.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [parameter, local, invalid] = entity.block.entries.filter(AST.isActionDeclaration)
    Expect.Is(parameter, AST.isActionDeclaration)
    Expect.Is(local, AST.isActionDeclaration)
    Expect.Is(invalid, AST.isActionDeclaration)
    for (const action of [parameter, local]) {
      const domain = Type.ofExpression(returnedValue(action))
      Assert(domain.kind === 'primitive', 'a shadow retains its own primitive domain')
      Expect(domain.primitive).toBe('text')
    }
    Expect(Type.ofExpression(returnedValue(invalid)).kind).toBe('unresolved')
  })
})

function returnedValue(action: AST.ActionDeclaration): AST.Expression {
  const statement = action.block?.statements.find(AST.isReturnStatement)
  Expect.Is(statement, AST.isReturnStatement)
  return statement.value
}
