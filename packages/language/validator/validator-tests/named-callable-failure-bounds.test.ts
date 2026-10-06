import { declaredCallableFailureContract } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { AssociatedMethodsValidationMessages as messages } from '../validator-src/validators/AssociatedMethodsValidationMessages'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: named callable failure bounds', () => {
  Test('retains every declared native failure at genuine ordinary and associated heads', async () => {
    const result = await testValidateCode(`
      func Read() fails Offline, InvalidInput -> text { return Read() from ./Native.ts }
      type Title is text with {
        func Read() fails Offline, InvalidInput -> text { return Read(Title) from ./Native.ts }
      }
    `)
    const declarations = AST.streamAllContents(result.entry.ast).filter(node =>
      AST.isFunctionDeclaration(node) || AST.isAssociatedFunctionDeclaration(node)
    )
    Expect(declarations).toHaveLength(2)
    for (const declaration of declarations) {
      Expect(declaredCallableFailureContract(declaration)).toEqual({ cases: ['Offline', 'InvalidInput'], open: false })
      Expect(result.associatedEffects?.analyses.get(declaration)?.effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: ['Offline', 'InvalidInput'], open: false },
      })
    }
  })

  Test('does not replace a source caller body with its narrower declared failure names', async () => {
    const result = await testValidateCodeWithErrors(`
      func Native() fails Offline -> text { return Export() from ./Native.ts }
      type Title is text with {
        func Read() fails InvalidInput -> text { return Native() }
      }
    `)
    Expect(validationErrorMessages(result)).toEqual([messages.failures('Read')])
    const caller = AST.streamAllContents(result.entry.ast).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(caller, AST.isAssociatedFunctionDeclaration)
    Expect(result.associatedEffects?.analyses.get(caller)?.effects.failures).toEqual({
      cases: ['Offline'],
      open: false,
    })
  })

  for (const bound of ['never, Offline', 'Offline, never']) {
    Test(`rejects mixed never and named bounds: ${bound}`, async () => {
      const result = await testValidateCodeWithErrors(`can Reader { Read() fails ${bound} -> text }`)
      Expect(validationErrorMessages(result)).toEqual([messages.failureBound])
    })
  }
})
