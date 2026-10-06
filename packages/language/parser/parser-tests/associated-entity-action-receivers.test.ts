import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Associated entity action receivers', () => {
  Test('links singular and collection action qualifiers to one actual containing entity', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        action Book.Read() -> text { return Book.Title },
        action Books.Read() -> Books { return Books }
      }
      action Ordinary() { }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [single, collection] = entity.block.entries.filter(AST.isActionDeclaration)
    Expect.Is(single, AST.isActionDeclaration)
    Expect.Is(collection, AST.isActionDeclaration)
    Expect(single.name).toBe('Read')
    Expect(single.receiverName).toBe('Book')
    Expect(collection.name).toBe('Read')
    Expect(collection.receiverName).toBe('Books')
    Expect(AST.associatedActionOwner(single)).toBe(entity)
    Expect(AST.associatedActionOwner(collection)).toBe(entity)
    Expect(AST.associatedEntityActionReceiver(single)?.owner).toBe(entity)
    Expect(AST.associatedEntityActionReceiver(single)?.cardinality).toBe('one')
    Expect(AST.associatedEntityActionReceiver(collection)?.owner).toBe(entity)
    Expect(AST.associatedEntityActionReceiver(collection)?.cardinality).toBe('many')
    const singleValue = returnedValue(single)
    Expect.Is(singleValue, AST.isMemberAccessExpression)
    const collectionValue = returnedValue(collection)
    Expect.Is(collectionValue, AST.isValueReference)
    Expect(singleValue.target.ref).toBe(entity)
    Expect(collectionValue.target.ref).toBe(entity)
    Expect(AST.associatedReceiverOwner(singleValue)).toBe(entity)
    Expect(AST.associatedReceiverOwner(collectionValue)).toBe(entity)
    const ordinary = file.statements.find(AST.isActionDeclaration)
    Expect.Is(ordinary, AST.isActionDeclaration)
    Expect(ordinary.receiverName).toBeUndefined()
    Expect(AST.associatedActionOwner(ordinary)).toBeUndefined()
    Expect(AST.associatedEntityActionReceiver(ordinary)).toBeUndefined()
  })

  Test('keeps parameters and lexical aliases closer than the entity receiver', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        action Book.Parameter(Book text) -> text { return Book },
        action Books.Local() -> text { let Books = "local" return Books }
      }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [parameterAction, localAction] = entity.block.entries.filter(AST.isActionDeclaration)
    Expect.Is(parameterAction, AST.isActionDeclaration)
    Expect.Is(localAction, AST.isActionDeclaration)
    const parameterValue = returnedValue(parameterAction)
    Expect.Is(parameterValue, AST.isValueReference)
    const localValue = returnedValue(localAction)
    Expect.Is(localValue, AST.isValueReference)
    Expect(parameterValue.target.ref).toBe(AST.parametersOf(parameterAction)[0])
    const alias = localAction.block?.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect(localValue.target.ref).toBe(alias)
    Expect(AST.associatedReceiverOwner(parameterValue)).toBeUndefined()
    Expect(AST.associatedReceiverOwner(localValue)).toBeUndefined()
  })

  Test('does not bind invalid qualifiers or expose collections in ordinary action scopes', async () => {
    const file = await parse(
      `
      data Books / Book {
        Title text,
        action Wrong.Invalid() { return Wrong },
        action Unqualified() { return Books },
        action Book.HiddenCollection() { return Books }
      }
      action Ordinary() { return Books }
    `,
      false,
    )
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [invalid, unqualified, single] = entity.block.entries.filter(AST.isActionDeclaration)
    Expect.Is(invalid, AST.isActionDeclaration)
    Expect.Is(unqualified, AST.isActionDeclaration)
    Expect.Is(single, AST.isActionDeclaration)
    Expect(AST.associatedActionOwner(invalid)).toBe(entity)
    Expect(AST.associatedEntityActionReceiver(invalid)).toBeUndefined()
    Expect(AST.associatedEntityActionReceiver(unqualified)).toBeUndefined()
    const ordinary = file.statements.find(AST.isActionDeclaration)
    Expect.Is(ordinary, AST.isActionDeclaration)
    for (const action of [invalid, unqualified, single, ordinary]) {
      const value = returnedValue(action)
      Expect.Is(value, AST.isValueReference)
      Expect(value.target.ref).toBeUndefined()
      Expect(AST.associatedReceiverOwner(value)).toBeUndefined()
    }
  })
})

async function parse(source: string, cleanLinks = true): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  if (cleanLinks) {
    Expect(parsed.diagnostics).toEqual([])
  }
  return parsed.entry.ast
}

function returnedValue(action: AST.ActionDeclaration): AST.Expression {
  const statement = action.block?.statements.find(AST.isReturnStatement)
  Expect.Is(statement, AST.isReturnStatement)
  return statement.value
}
