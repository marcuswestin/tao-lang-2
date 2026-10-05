import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { ownAssociatedMethods } from '../ast-utils-src/associated-methods'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { Type } from '../ast-utils-src/Type'

Describe('Contextual item field read publication', () => {
  Test('closes an actual item-owned method selecting one immutable capability field', async () => {
    const file = await parse(`
      can Display { ToText() fails never -> text }
      type Row is {
        Content Display,
        func Read() fails never -> text { return Row.Content.ToText() }
      }
      func Read(Value Row) fails never -> text { return Value.Read() }
    `)
    const row = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Row')
    Expect.Is(row, AST.isTypeDeclaration)
    const method = ownAssociatedMethods(row)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const selection = AST.streamAllContents(method).find(AST.isMemberAccessExpression)
    Expect.Is(selection, AST.isMemberAccessExpression)
    Expect(selection.target.ref).toBe(row)
    Expect(AST.associatedReceiverOwner(selection)).toBe(row)
    const domain = Type.ofReferenceRoot(selection)
    Expect(domain.kind).toBe('item')
    Expect(domain.nominal).toBe(row)
    const selected = Type.atMemberPath(domain, ['Content'])
    Expect(selected.kind).toBe('capability')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const call = selection.$container
    Expect.Is(call, AST.isMethodCallExpression)
    Expect(snapshot.calls.get(call)?.kind).toBe('complete')
    const read = snapshot.reads.get(selection)
    Expect(read?.classification).toBe('immutable')
    Expect(read?.kind).toBe('complete')
    Expect(read?.proof?.kind).toBe('contextual-owner')
    Expect(read?.proof?.owner).toBe(row)
    const registered = createAssociatedEffects([file])
    Expect(registered.analyses.get(method)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    const caller = file.statements.find(AST.isFunctionDeclaration)
    Expect.Is(caller, AST.isFunctionDeclaration)
    Expect(registered.analyses.get(caller)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test(
    'keeps bare items, incomplete selections and entity receivers conservative and mutable shadows reactive',
    async () => {
      const file = await parse(`
      can Display { ToText() fails never -> text }
      type Row is {
        Content Display,
        func Whole() fails never -> Row { return Row },
        func Missing() fails never -> text { return Row.Content.Absent() },
        func Shadow(mutable Row Row) fails never -> text { return Row.Content.ToText() }
      }
      data Books / Book { Title text, func Book.Read() fails never -> text { return Book.Title } }
    `)
      const row = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Row')
      Expect.Is(row, AST.isTypeDeclaration)
      const [whole, missing, shadow] = ownAssociatedMethods(row)
      Expect.Is(whole, AST.isAssociatedFunctionDeclaration)
      Expect.Is(missing, AST.isAssociatedFunctionDeclaration)
      Expect.Is(shadow, AST.isAssociatedFunctionDeclaration)
      const entity = file.statements.find(AST.isEntityDataDeclaration)
      Expect.Is(entity, AST.isEntityDataDeclaration)
      const entityMethod = ownAssociatedMethods(entity)[0]
      Expect.Is(entityMethod, AST.isAssociatedFunctionDeclaration)
      const snapshot = publishCanonicalEffectSnapshot([file])
      for (const method of [whole, missing, entityMethod]) {
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
      const reference = AST.streamAllContents(shadow).find(AST.isMemberAccessExpression)
      Expect.Is(reference, AST.isMemberAccessExpression)
      Expect(reference.target.ref).toBe(AST.parametersOf(shadow)[0])
      Expect(AST.associatedReceiverOwner(reference)).toBeUndefined()
      Expect(snapshot.reads.get(reference)?.classification).toBe('reactive')
    },
  )
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}
