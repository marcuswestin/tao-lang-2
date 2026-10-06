import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parseCodeWithErrors, testParseSyntax } from './test-parse'

Describe('parser: callable failure bounds', () => {
  Test('keeps the first bound and captures additional ordinary, associated, and capability bounds', async () => {
    const parsed = await testParseSyntax(`
      func Plain() fails Offline, Busy -> text { return "plain" }
      type Token is text with {
        func Render() fails never -> text { return "token" }
        static func + (Value Token) fails Rejected, Expired -> Token { return Value }
      }
      can Display {
        Render() fails never -> text,
        Format() fails Offline, Busy -> text
      }
    `)

    const file = parsed.entry.ast
    const plain = file.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === 'Plain')
    Expect.Is(plain, AST.isFunctionDeclaration)
    Expect([plain.failureBound, plain.additionalFailureBounds]).toEqual(['Offline', ['Busy']])

    const token = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Token')
    Expect.Is(token, AST.isTypeDeclaration)
    Expect.Is(token.type, AST.isDerivedTypeExpression)
    const [instance, operator] = token.type.slots.methods
    Expect.Is(instance, AST.isAssociatedFunctionDeclaration)
    Expect.Is(operator, AST.isAssociatedFunctionDeclaration)
    Expect([instance.failureBound, instance.additionalFailureBounds]).toEqual(['never', []])
    Expect([operator.name, operator.failureBound, operator.additionalFailureBounds]).toEqual([
      '+',
      'Rejected',
      ['Expired'],
    ])

    const display = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Display')
    Expect.Is(display, AST.isTypeDeclaration)
    Expect.Is(display.type, AST.isCapabilityTypeExpression)
    Expect(display.type.methods.map(method => [method.failureBound, method.additionalFailureBounds])).toEqual([
      ['never', []],
      ['Offline', ['Busy']],
    ])
  })

  Test('keeps bare fails syntactically incomplete', async () => {
    const parsed = await parseCodeWithErrors('func Incomplete() fails -> text { return "incomplete" }')
    Expect(parsed.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
  })
})
