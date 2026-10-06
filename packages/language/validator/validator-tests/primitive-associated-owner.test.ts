import { ASTUtils } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const source = `
  primitive number with {
    static func +(Left number, Right number) fails never -> number { return Left }
    static func -(Left number, Right number) fails never -> number { return Left }
    func -(Value number) fails never -> number { return Value }
    static func +(Left number, Right number) fails never -> number { return Left }
    func Repeat() fails never -> number { return 1 }
    func Repeat() fails never -> number { return 2 }
  }
`

Describe('Primitive associated callable owners', () => {
  Test('publishes real primitive methods and rejects only exact operator contracts', async () => {
    const parsed = await Parser.parseCode(source, { validation: false })
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])

    const owner = parsed.entry.ast.statements.find(AST.isPrimitiveDeclaration)
    Expect.Is(owner, AST.isPrimitiveDeclaration)
    const methods = ASTUtils.ownAssociatedMethods(owner)
    Expect(methods).toHaveLength(6)
    const snapshot = ASTUtils.publishCanonicalEffectSnapshot([parsed.entry.ast])
    for (const method of methods) {
      Expect(snapshot.descriptors.get(method)?.owner).toBe(owner)
      Expect(snapshot.associatedDescriptors.has(method)).toBe(true)
    }

    const validated = await testValidateCodeWithErrors(source)
    Expect(validationErrorMessages(validated)).toEqual([
      "Associated method '+' is declared more than once on 'number'.",
      "Associated method 'Repeat' is declared more than once on 'number'.",
      'Primitive declarations are allowed only in the pinned Tao prelude.',
    ])
  })
})
