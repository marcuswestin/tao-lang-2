import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('associated actions', () => {
  Test('parses singular and plural owner actions in entity entries', async () => {
    const parsed = await Parser.parseCode(
      `
      data Books / Book {
        Title text,
        Returned yes / NotReturned no,
        action Book.Return() { update Book { Returned yes } },
        action Books.Return() { loop Books / Book { do Book.Return() } },
      }
      action Ordinary() { }
      `,
      { validation: false },
    )

    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const entity = parsed.entry.ast.statements.find(
      statement => AST.isEntityDataDeclaration(statement) && statement.name === 'Books',
    )
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [title, returned, singular, plural] = entity.block.entries
    Expect.Is(title, AST.isEntityDataField)
    Expect.Is(returned, AST.isEntityDataField)
    Expect.Is(singular, AST.isActionDeclaration)
    Expect.Is(plural, AST.isActionDeclaration)
    Expect([singular.receiverName, singular.name, plural.receiverName, plural.name]).toEqual([
      'Book',
      'Return',
      'Books',
      'Return',
    ])
    Expect.Is(singular.block?.statements[0], AST.isUpdateStatement)
    const loop = plural.block?.statements[0]
    Expect.Is(loop, AST.isForStatement)
    const invocation = loop.block.statements[0]
    Expect.Is(invocation, AST.isDoStatement)
    Expect.Is(invocation.action, AST.isMemberAccessExpression)
    Expect(invocation.action.members).toEqual(['Return'])

    const ordinary = parsed.entry.ast.statements.find(
      statement => AST.isActionDeclaration(statement) && statement.name === 'Ordinary',
    )
    Expect.Is(ordinary, AST.isActionDeclaration)
    Expect(ordinary.receiverName).toBeUndefined()
  })

  Test('parses nominal instance and static actions, action requirements, and atomic controlled handlers', async () => {
    const parsed = await Parser.parseCode(
      `
      type File is item with {
        action Read(Length number) returns number from ./Bindings.ts,
        static action Construct(Path text) returns File from ./Bindings.ts
      }
      type Result is item
      can ByteReader { action Read(Length number) fails Failure -> Result }
      action Save() { }
      view Button(Press action()) { }
      view Main() { render Button() { on press (preventDefault) -> do Save() } }
      `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const fileType = parsed.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'File',
    )
    Expect.Is(fileType, AST.isTypeDeclaration)
    Expect.Is(fileType.type, AST.isDerivedTypeExpression)
    const [read, construct] = fileType.type.slots.actions
    Expect.Is(read, AST.isActionDeclaration)
    Expect.Is(construct, AST.isActionDeclaration)
    Expect(read.static).toBe(false)
    Expect(construct.static).toBe(true)
    const capability = parsed.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'ByteReader',
    )
    Expect.Is(capability, AST.isTypeDeclaration)
    Expect.Is(capability.type, AST.isCapabilityTypeExpression)
    Expect.Is(capability.type.actions[0], AST.isCapabilityActionDeclaration)
    const handler = AST.streamAllContents(parsed.entry.ast).find(AST.isEventHandler)
    Expect.Is(handler?.block?.statements[0], AST.isDoStatement)
  })
})
