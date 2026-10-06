import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('associated view owners', () => {
  Test('links the declared type owner and lets parameters shadow its name', async () => {
    const parsed = await Parser.parseCode(
      `
      can ui { Render() -> rendered }
      view Text(Value text) { }
      type Card is text with {
        func Label(Value text) -> text { return Value }
        view Card.Render(Value text) { render Text(Card.Label(Value)) }
        view Card.Shadow(Card text) { render Text(Card) }
      }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])

    const owner = parsed.entry.ast.statements.find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Card'
    )
    Expect.Is(owner, AST.isTypeDeclaration)
    Expect.Is(owner.type, AST.isDerivedTypeExpression)
    const [renderView, shadowView] = owner.type.slots.views
    Expect.Is(renderView, AST.isAssociatedViewDeclaration)
    Expect.Is(shadowView, AST.isAssociatedViewDeclaration)
    Expect(AST.associatedViewOwner(renderView)).toBe(owner)
    Expect(AST.associatedViewOwner(shadowView)).toBe(owner)

    const references = AST.streamAllContents(parsed.entry.ast).filter(AST.isValueReference)
    const renderOwnerReference = AST.streamAllContents(parsed.entry.ast).find(reference =>
      AST.isMemberAccessExpression(reference)
      && AST.findOwningAssociatedView(reference) === renderView
      && reference.target.ref === owner
    )
    Expect.Is(renderOwnerReference, AST.isMemberAccessExpression)
    const shadowParameter = AST.parametersOf(shadowView)[0]
    Expect.Is(shadowParameter, AST.isParameterDeclaration)
    const shadowedReference = references.find(reference =>
      AST.findOwningAssociatedView(reference) === shadowView && reference.target.$refText === 'Card'
    )
    Expect.Is(shadowedReference, AST.isValueReference)
    Expect(shadowedReference.target.ref).toBe(shadowParameter)
    const valueParameter = AST.parametersOf(renderView)[0]
    Expect.Is(valueParameter, AST.isParameterDeclaration)
    const valueReference = references.find(reference =>
      AST.findOwningAssociatedView(reference) === renderView && reference.target.$refText === 'Value'
    )
    Expect.Is(valueReference, AST.isValueReference)
    Expect(valueReference.target.ref).toBe(valueParameter)
  })
})
