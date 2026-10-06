import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('associated entity owners', () => {
  Test('binds a qualified singular receiver while preserving entity entries and local shadowing', async () => {
    const parsed = await Parser.parseCode(
      `
      data Books / Book {
        Title text,
        index Title,
        func Book.Key() -> text { return Book.Title },
        func Book.Shadow(Book text) -> text { return Book },
        view Book.Render() { }
      }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])

    const entity = parsed.entry.ast.statements.find(statement =>
      AST.isEntityDataDeclaration(statement) && statement.name === 'Books'
    )
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [title, index, key, shadow, view] = entity.block.entries
    Expect.Is(title, AST.isEntityDataField)
    Expect(title.name).toBe('Title')
    Expect.Is(index, AST.isDataIndex)
    Expect(index.fieldName).toBe('Title')
    Expect.Is(key, AST.isAssociatedFunctionDeclaration)
    Expect.Is(shadow, AST.isAssociatedFunctionDeclaration)
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    Expect(AST.associatedEntityReceiverOwner(key)).toBe(entity)
    Expect(AST.associatedEntityReceiverOwner(view)).toBe(entity)

    const receiverPath = AST.streamAllContents(parsed.entry.ast).find(node =>
      AST.isMemberAccessExpression(node) && AST.findOwningAssociatedFunction(node) === key
    )
    Expect.Is(receiverPath, AST.isMemberAccessExpression)
    Expect(receiverPath.target.ref).toBe(entity)
    Expect(receiverPath.members).toEqual(['Title'])

    const shadowParameter = AST.parametersOf(shadow)[0]
    Expect.Is(shadowParameter, AST.isParameterDeclaration)
    const shadowedReference = AST.streamAllContents(parsed.entry.ast).find(node =>
      AST.isValueReference(node)
      && AST.findOwningAssociatedFunction(node) === shadow
      && node.target.$refText === 'Book'
    )
    Expect.Is(shadowedReference, AST.isValueReference)
    Expect(shadowedReference.target.ref).toBe(shadowParameter)
  })
})
