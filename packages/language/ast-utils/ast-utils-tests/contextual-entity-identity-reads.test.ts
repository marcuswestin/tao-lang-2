import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { ownAssociatedMethods } from '../ast-utils-src/associated-methods'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { Type } from '../ast-utils-src/Type'

Describe('Contextual entity identity read publication', () => {
  Test('closes a real row identity key method and its caller with declared failure bounds', async () => {
    const file = await parse(`
      type RenderKey is text
      data Books / Book {
        Title text,
        func Book.Key() fails never -> RenderKey { return RenderKey "book:{Book.Id}" }
      }
      func Read(Value Book) fails never -> RenderKey { return Value.Key() }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const method = ownAssociatedMethods(entity)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const identity = memberRead(method)
    Expect(identity.members).toEqual(['Id'])
    Expect(identity.target.ref).toBe(entity)
    Expect(AST.associatedReceiverOwner(identity)).toBe(entity)
    const domain = Type.ofReferenceRoot(identity)
    Expect(domain.kind === 'entity' && domain.entity === entity).toBe(true)
    Expect(Type.ofExpression(identity)).toEqual({ kind: 'primitive', primitive: 'text' })
    const snapshot = publishCanonicalEffectSnapshot([file])
    const read = snapshot.reads.get(identity)
    Expect(read?.classification).toBe('immutable')
    Expect(read?.kind).toBe('complete')
    Expect(read?.proof?.kind).toBe('contextual-owner')
    Expect(read?.proof?.owner).toBe(entity)
    const registered = createAssociatedEffects([file])
    const caller = file.statements.find(AST.isFunctionDeclaration)
    Expect.Is(caller, AST.isFunctionDeclaration)
    for (const declaration of [method, caller]) {
      Expect(registered.analyses.get(declaration)?.effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      })
    }
  })

  Test(
    'keeps bare entities, authored fields, nested identities, status and collection identity reads unknown',
    async () => {
      const file = await parse(
        `
      data Books / Book {
        Title text,
        Parent Book,
        func Book.Whole() fails never -> Book { return Book },
        func Book.Field() fails never -> text { return Book.Title },
        func Book.Nested() fails never -> text { return Book.Parent.Id },
        func Book.Status() fails never -> text { return "{Book.CanRetryWrites}" },
        action Books.CollectionIdentity() -> text { return Books.Id },
        func Wrong.Invalid() fails never -> text { return Wrong.Id }
      }
    `,
        ["No value named 'Wrong' is in scope."],
      )
      const entity = file.statements.find(AST.isEntityDataDeclaration)
      Expect.Is(entity, AST.isEntityDataDeclaration)
      const snapshot = publishCanonicalEffectSnapshot([file])
      for (const method of ownAssociatedMethods(entity)) {
        const reference = AST.streamAllContents(method).find(node =>
          AST.isValueReference(node) || AST.isMemberAccessExpression(node)
        )
        Expect.Is(
          reference,
          (node): node is AST.ValueReference | AST.MemberAccessExpression =>
            AST.isValueReference(node) || AST.isMemberAccessExpression(node),
        )
        Expect(snapshot.reads.get(reference)?.classification).toBe('unknown')
        Expect(snapshot.reads.get(reference)?.kind).toBe('unknown')
      }
      const collection = entity.block.entries.find(AST.isActionDeclaration)
      Expect.Is(collection, AST.isActionDeclaration)
      const identity = memberRead(collection)
      Expect(identity.members).toEqual(['Id'])
      const domain = Type.ofReferenceRoot(identity)
      Expect(domain.kind === 'list' && domain.element?.kind === 'entity' && domain.element.entity === entity).toBe(true)
      Expect(AST.associatedReceiverOwner(identity)).toBe(entity)
      Expect(snapshot.reads.get(identity)?.classification).toBe('unknown')
    },
  )

  Test('preserves mutable shadows as reactive and leaves noncontextual identity reads unknown', async () => {
    const file = await parse(
      `
      data Books / Book {
        Title text,
        func Book.Mutable(mutable Book Book) fails never -> text { return Book.Id },
        func Book.Copied(copy Book Book) fails never -> text { return Book.Id }
      }
      func Ordinary(Value Book) fails never -> text { return Value.Id }
      func Outside() fails never -> text { return Book.Id }
    `,
      ["No value named 'Book' is in scope."],
    )
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const method of ownAssociatedMethods(entity)) {
      const identity = memberRead(method)
      Expect(identity.target.ref).toBe(AST.parametersOf(method)[0])
      Expect(AST.associatedReceiverOwner(identity)).toBeUndefined()
      Expect(snapshot.reads.get(identity)?.classification).toBe('reactive')
    }
    for (const fn of file.statements.filter(AST.isFunctionDeclaration)) {
      const identity = memberRead(fn)
      Expect(AST.associatedReceiverOwner(identity)).toBeUndefined()
      Expect(snapshot.reads.get(identity)?.classification).toBe('unknown')
    }
  })
})

async function parse(source: string, expectedDiagnostics: readonly string[] = []): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual(expectedDiagnostics)
  return parsed.entry.ast
}

function memberRead(owner: AST.Node): AST.MemberAccessExpression {
  const reference = AST.streamAllContents(owner).find(AST.isMemberAccessExpression)
  Expect.Is(reference, AST.isMemberAccessExpression)
  return reference
}
