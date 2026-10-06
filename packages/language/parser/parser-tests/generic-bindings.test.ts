import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('parser: generic bindings', () => {
  Test('parses generic function and associated function bounds before their parameters', () => {
    const parsed = Parser.parseSyntax(`
      func EarlierLabel where type T is Ordered and Display, type T2 is Other (Left T, Right T, Foo T2) -> text { return "" }
      type Box is {
        func Keep where type T is Self (Value T) -> T { return Value }
      }
    `)

    Expect(parsed.errors).toBe(0)
    const declaration = parsed.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(declaration, AST.isFunctionDeclaration)
    Expect(declaration.genericParameters.map(parameter => parameter.name)).toEqual(['T', 'T2'])
    Expect(declaration.genericParameters[0]?.bounds.map(bound => AST.isNamedTypeReference(bound) ? bound.root : ''))
      .toEqual([
        'Ordered',
        'Display',
      ])
    Expect(declaration.genericParameters[1]?.bounds.map(bound => AST.isNamedTypeReference(bound) ? bound.root : ''))
      .toEqual([
        'Other',
      ])

    const box = parsed.ast.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Box')
    Expect.Is(box, AST.isTypeDeclaration)
    Expect.Is(box.type, AST.isItemTypeExpression)
    const associated = box.type.methods[0]
    Expect.Is(associated, AST.isAssociatedFunctionDeclaration)
    Expect(associated.genericParameters.map(parameter => parameter.name)).toEqual(['T'])
    Expect.Is(associated.genericParameters[0]?.bounds[0], AST.isNamedTypeReference)
    Expect(associated.genericParameters[0]?.bounds[0]?.root).toBe('Self')
  })
})
