import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { AssociatedMethodsValidationMessages as messages } from '../validator-src/validators/AssociatedMethodsValidationMessages'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { accepts, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: converter source effects', () => {
  Test(
    'accepts a complete pure converter and a pure function invoking it',
    accepts(`
    type Token is text with { Token as text fails never { return "token" } }
    type Reader is text with {
      func Convert(Value Token) fails never -> text { return Value as text }
    }
    func Convert(Value Token) fails never -> text { return Value as text }
  `),
  )

  Test('rejects an unattested bridge in an otherwise pure converter', async () => {
    const result = await testValidateCodeWithErrors(`
      let Host is text = Native from ./Native.ts
      type Token is text with { Token as text { return Host } }
    `)
    const converter = AST.streamAllContents(result.entry.ast).find(AST.isAssociatedConverterDeclaration)
    Expect.Is(converter, AST.isAssociatedConverterDeclaration)
    const alias = result.entry.ast.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isFromExpression)
    Expect(validationErrorMessages(result)).toEqual([messages.converterPurity])
  })

  Test('rejects a source workspace when a pure function invokes an impure converter', async () => {
    const result = await testValidateCodeWithErrors(`
      let Host is text = Native from ./Native.ts
      type Token is text with { Token as text { return Host } }
      func Convert(Value Token) -> text { return Value as text }
    `)
    const fn = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    const conversion = AST.returnStatementsOf(fn)[0]?.value
    Expect.Is(conversion, AST.isConversionExpression)
    Expect(validationErrorMessages(result)).toEqual([
      messages.converterPurity,
      FunctionsValidator.messages.functionPurity('Convert'),
    ])
  })

  Test(
    'accepts complete pure authored operators in pure functions',
    accepts(`
    type Scalar is numeric with {
      static func +(Left Scalar, Right Scalar) fails never -> Scalar { return Left }
      static func -(Value Scalar) fails never -> Scalar { return Value }
    }
    type Calculator is text with {
      func Add(Left Scalar, Right Scalar) fails never -> Scalar { return Left + Right }
    }
    func Add(Left Scalar, Right Scalar) fails never -> Scalar { return Left + Right }
    func Negate(Value Scalar) fails never -> Scalar { return -Value }
  `),
  )

  Test('rejects a source workspace when a pure function invokes an operator with a bridge read', async () => {
    const result = await testValidateCodeWithErrors(`
      let Host is Scalar = Native from ./Native.ts
      type Scalar is numeric with {
        static func +(Left Scalar, Right Scalar) -> Scalar { return Host }
      }
      func Add(Left Scalar, Right Scalar) -> Scalar { return Left + Right }
    `)
    const fn = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    Expect.Is(AST.returnStatementsOf(fn)[0]?.value, AST.isBinaryExpression)
    Expect(validationErrorMessages(result)).toEqual([
      messages.purity('+'),
      FunctionsValidator.messages.functionPurity('Add'),
    ])
  })

  Test('rejects an associated pure function executing an unattested converter body', async () => {
    const result = await testValidateCodeWithErrors(`
      let Host is text = Native from ./Native.ts
      type Token is text with { Token as text { return Host } }
      type Reader is text with {
        func Convert(Value Token) -> text { return Value as text }
      }
    `)
    const method = AST.streamAllContents(result.entry.ast).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    Expect.Is(AST.returnStatementsOf(method)[0]?.value, AST.isConversionExpression)
    Expect(validationErrorMessages(result)).toEqual([messages.converterPurity, messages.purity('Convert')])
  })

  Test('rejects an associated pure function executing an unattested authored operator body', async () => {
    const result = await testValidateCodeWithErrors(`
      let Host is Scalar = Native from ./Native.ts
      type Scalar is numeric with {
        static func +(Left Scalar, Right Scalar) -> Scalar { return Host }
      }
      type Calculator is text with {
        func Add(Left Scalar, Right Scalar) -> Scalar { return Left + Right }
      }
    `)
    const methods = AST.streamAllContents(result.entry.ast).filter(AST.isAssociatedFunctionDeclaration)
    const add = methods.find(method => method.name === 'Add')
    Expect.Is(add, AST.isAssociatedFunctionDeclaration)
    Expect.Is(AST.returnStatementsOf(add)[0]?.value, AST.isBinaryExpression)
    Expect(validationErrorMessages(result)).toEqual([messages.purity('+'), messages.purity('Add')])
  })

  Test(
    'accepts a declared native pure wrapper and an ordinary function invoking it',
    accepts(`
    func Native(Value text) -> text { return Export(Value) from ./Native.ts }
    func Caller(Value text) -> text { return Native(Value) }
  `),
  )

  Test('rejects an ordinary function evaluating an unclassified imported value', async () => {
    const result = await testValidateCodeWithErrors(`
      let Host is text = Export from ./Native.ts
      func Read() -> text { return Host }
    `)
    const fn = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    Expect(validationErrorMessages(result)).toEqual([FunctionsValidator.messages.functionPurity('Read')])
  })

  Test('rejects an executing default around a declared native pure wrapper', async () => {
    const result = await testValidateCodeWithErrors(`
      let Host is text = Export from ./Native.ts
      func Native(Value text default Host) -> text { return Export(Value) from ./Native.ts }
    `)
    const fn = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    Expect(fn.parameterList.parameters[0]?.defaultValue).toBeDefined()
    Expect(validationErrorMessages(result)).toEqual([FunctionsValidator.messages.functionPurity('Native')])
  })

  Test(
    'accepts native associated methods and converters under their declared pure contracts',
    accepts(`
    type Token is text with {
      func Native(Value text) -> text { return Export(Value) from ./Native.ts }
      Token as text { return Convert() from ./Native.ts }
    }
    func Caller(Value Token) -> text { return Value as text }
  `),
  )

  Test(
    'keeps a foreign call head separate from a same-named Tao signature',
    accepts(`
    func Export(Value number) -> number { return Value }
    func Native() -> text { return Export() from ./Native.ts }
  `),
  )

  Test('keeps action execution and suspension syntax outside ordinary pure source functions', async () => {
    for (
      const source of [
        'action Save() { } func Run() { do Save() return 1 }',
        'func Suspend() { async { return 1 } return 1 }',
      ]
    ) {
      const result = await testValidateCodeWithErrors(source)
      Expect(result.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    }
  })
})
