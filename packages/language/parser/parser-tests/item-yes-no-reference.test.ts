import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('yes/no item field type references', () => {
  Test('parses an entity-shaped field, an ordinary field, and yes/no in one item type', async () => {
    const parsed = await Parser.parseCode(
      'type Revision is { Book, RevisionID text, Unseen yes/no }',
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])

    const revision = parsed.entry.ast.statements.find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Revision'
    )
    Expect.Is(revision, AST.isTypeDeclaration)
    Expect.Is(revision.type, AST.isItemTypeExpression)
    const [book, revisionId, unseen] = revision.type.properties
    Expect.Is(book, AST.isTypeProperty)
    Expect(book.name).toBe('Book')
    Expect(book.type).toBeUndefined()
    Expect.Is(revisionId, AST.isTypeProperty)
    Expect(revisionId.name).toBe('RevisionID')
    Expect.Is(revisionId.type, AST.isPrimitiveTypeReference)
    Expect.Is(unseen, AST.isTypeProperty)
    Expect(unseen.name).toBe('Unseen')
    Expect.Is(unseen.type, AST.isYesNoTypeExpression)
  })
})
