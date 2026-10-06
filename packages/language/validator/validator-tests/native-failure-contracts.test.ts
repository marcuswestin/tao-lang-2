import { AST } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AssociatedMethodsValidationMessages as messages } from '../validator-src/validators/AssociatedMethodsValidationMessages'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: declared native failure contracts', () => {
  Test('accepts a fails-never native head through a real associated caller', async () => {
    const result = await testValidateCode(`
      func UpperCase(Value text) fails never -> text { return Export(Value) from ./Native.ts }
      type Title is text with {
        func Title.ToText() fails never -> text { return UpperCase(Title) }
      }
    `)
    const native = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    const caller = AST.streamAllContents(result.entry.ast).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(native, AST.isFunctionDeclaration)
    Expect.Is(caller, AST.isAssociatedFunctionDeclaration)
    const bridge = AST.returnStatementsOf(native)[0]?.value
    Expect.Is(bridge, AST.isFromExpression)
    Expect.Is(bridge.expression, AST.isFunctionCallExpression)
    const registered = result.associatedEffects
    Assert.defined(registered, 'source validation retains the registered effect analyses')
    const analyses = registered.analyses
    for (const declaration of [native, caller]) {
      Expect(analyses.get(declaration)?.effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      })
    }
  })

  Test('keeps unspecified native failures open while the pure contract stays closed', async () => {
    const result = await testValidateCodeWithErrors(`
      func UpperCase(Value text) -> text { return Export(Value) from ./Native.ts }
      type Title is text with {
        func Title.ToText() fails never -> text { return UpperCase(Title) }
      }
    `)
    Expect(validationErrorMessages(result)).toEqual([messages.failures('ToText')])
    const native = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(native, AST.isFunctionDeclaration)
    const registered = result.associatedEffects
    Assert.defined(registered, 'source validation retains the registered effect analyses')
    Expect(registered.analyses.get(native)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    })
  })

  Test('uses actual converter bounds for native heads without closing unspecified failures', async () => {
    const result = await testValidateCode(`
      type Title is text with { Title as text fails never { return Export() from ./Native.ts } }
      type Token is text with { Token as text { return Export() from ./Native.ts } }
    `)
    const converters = AST.streamAllContents(result.entry.ast).filter(AST.isAssociatedConverterDeclaration)
    Expect(converters.map(converter => converter.failureBounds)).toEqual([['never'], []])
    const registered = result.associatedEffects
    Assert.defined(registered, 'source validation retains the registered effect analyses')
    Expect(converters.map(converter => registered.analyses.get(converter)?.effects)).toEqual([
      { purity: { violations: [], open: false }, failures: { cases: [], open: false } },
      { purity: { violations: [], open: false }, failures: { cases: [], open: true } },
    ])
  })

  Test('does not let a fails-never head erase an executing native wrapper default', async () => {
    const result = await testValidateCodeWithErrors(`
      func Open() -> text { return Export() from ./Native.ts }
      func UpperCase(Value text default Open()) fails never -> text { return Export(Value) from ./Native.ts }
      type Title is text with {
        func Title.ToText() fails never -> text { return UpperCase() }
      }
    `)
    Expect(validationErrorMessages(result)).toEqual([messages.failures('ToText')])
    const native = result.entry.ast.statements.find(value =>
      AST.isFunctionDeclaration(value) && value.name === 'UpperCase'
    )
    Expect.Is(native, AST.isFunctionDeclaration)
    Assert.defined(native.parameterList.parameters[0]?.defaultValue, 'the real default executes independently')
    const registered = result.associatedEffects
    Assert.defined(registered, 'source validation retains the registered effect analyses')
    Expect(registered.analyses.get(native)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    })
  })

  Test('does not let a fails-never head erase an executing argument failure', async () => {
    const result = await testValidateCodeWithErrors(`
      func Open() -> text { return Export() from ./Native.ts }
      func UpperCase(Value text) fails never -> text { return Export(Value) from ./Native.ts }
      type Title is text with {
        func Title.ToText() fails never -> text { return UpperCase(Open()) }
      }
    `)
    Expect(validationErrorMessages(result)).toEqual([messages.failures('ToText')])
    const native = result.entry.ast.statements.find(value =>
      AST.isFunctionDeclaration(value) && value.name === 'UpperCase'
    )
    const caller = AST.streamAllContents(result.entry.ast).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(native, AST.isFunctionDeclaration)
    Expect.Is(caller, AST.isAssociatedFunctionDeclaration)
    const call = AST.returnStatementsOf(caller)[0]?.value
    Expect.Is(call, AST.isFunctionCallExpression)
    Expect.Is(call.argumentList?.arguments[0]?.value, AST.isFunctionCallExpression)
    const registered = result.associatedEffects
    Assert.defined(registered, 'source validation retains the registered effect analyses')
    Expect(registered.analyses.get(native)?.effects.failures).toEqual({ cases: [], open: false })
    Expect(registered.analyses.get(caller)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    })
  })
})
