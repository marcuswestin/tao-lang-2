import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parseCodeWithErrors, rejectsParser, testParseCode } from './test-parse'

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

function methodOf(declaration: AST.TypeDeclaration): AST.AssociatedFunctionDeclaration {
  Expect.Is(declaration.type, AST.isDerivedTypeExpression)
  const method = declaration.type.slots.methods[0]
  Expect.Is(method, AST.isAssociatedFunctionDeclaration)
  return method
}

Describe('parser: associated methods', () => {
  Test('keeps nominal methods, structural requirements and ordinary forwarding functions distinct', async () => {
    const result = await testParseCode(`
      type Token is text with {
        func ToText() fails never -> text { return "token:{Token}" }
      }
      type Label is text with {
        func ToText() -> text { return "label:{Label}" }
      }
      type Child is Token
      can Display { ToText() fails never -> text }
      func Relay(Value Display) -> Display { return Value }
      func Show(Value Display) -> text { return Relay(Value).ToText() }
      let First = Token "a"
      let Second = Label "b"
      let Inherited = Child "c"
      let FirstText = Show(First)
      let SecondText = Show(Second)
      let InheritedText = Show(Inherited)
    `)
    const file = result.entry.ast
    const token = namedType(file, 'Token')
    const label = namedType(file, 'Label')
    const child = namedType(file, 'Child')
    const display = namedType(file, 'Display')
    const tokenMethod = methodOf(token)
    const labelMethod = methodOf(label)
    Expect(tokenMethod.name).toBe('ToText')
    Expect(tokenMethod.failureBound).toBe('never')
    Expect(labelMethod.failureBound).toBeUndefined()
    Expect(AST.isFunctionDeclaration(tokenMethod)).toBe(false)
    Expect(AST.associatedFunctionOwner(tokenMethod)).toBe(token)
    Expect(AST.associatedFunctionOwner(labelMethod)).toBe(label)
    Expect(AST.parametersOf(tokenMethod)).toEqual([])
    Expect(AST.functionHasFallthroughReturn(tokenMethod)).toBe(true)
    Expect.Is(child.type, AST.isNamedTypeReference)
    Expect(child.type.root).toBe('Token')
    Expect.Is(display.type, AST.isCapabilityTypeExpression)
    const requirement = display.type.methods[0]
    Expect.Is(requirement, AST.isCapabilityMethodDeclaration)
    Expect(requirement.name).toBe('ToText')
    Expect(requirement.failureBound).toBe('never')
    Expect.Is(requirement.returnType, AST.isPrimitiveTypeReference)
    Expect(requirement.returnType.primitive).toBe('text')
    Expect(AST.parametersOf(requirement)).toEqual([])

    for (const [owner, method, prefix] of [[token, tokenMethod, 'token:'], [label, labelMethod, 'label:']] as const) {
      const returned = AST.returnStatementsOf(method)[0]?.value
      Expect.Is(returned, AST.isInterpolatedString)
      const text = returned.parts[0]
      Expect.Is(text, AST.isInterpolatedStringText)
      Expect(text.value).toBe(prefix)
      const hole = returned.parts.find(AST.isStringInterpolation)
      Expect.Is(hole, AST.isStringInterpolation)
      Expect.Is(hole.expression, AST.isValueReference)
      Expect(hole.expression.target.ref).toBe(owner)
      Expect(AST.associatedReceiverOwner(hole.expression)).toBe(owner)
      Expect(AST.findOwningAssociatedFunction(hole.expression)).toBe(method)
    }
    const show = file.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === 'Show')
    const relay = file.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === 'Relay')
    Expect.Is(show, AST.isFunctionDeclaration)
    Expect.Is(relay, AST.isFunctionDeclaration)
    const call = AST.returnStatementsOf(show)[0]?.value
    Expect.Is(call, AST.isMethodCallExpression)
    Expect.Is(call.callee, AST.isPostfixMemberAccess)
    Expect(call.callee.member).toBe('ToText')
    Expect.Is(call.callee.receiver, AST.isFunctionCallExpression)
    Expect(call.callee.receiver.function.ref).toBe(relay)
    Expect(AST.argumentsOf(call)).toEqual([])
    const argument = AST.argumentsOf(call.callee.receiver)[0]?.value
    Expect.Is(argument, AST.isValueReference)
    Expect(argument.target.ref).toBe(AST.parametersOf(show)[0])
  })

  Test('preserves named calls and chained member calls in every postfix expression context', async () => {
    const result = await testParseCode(`
      can Display { ToText() -> text }
      func Name() -> text { return "hello" }
      func Show(Value Display) -> text { return Value.ToText() }
      func Read(Value { Inner Display }) -> text { return Value.Inner.ToText() }
      let Named = Name()
      let Chained = Show({ Inner: "hello" }).ToText().Again()
      let Branch = when Name() == "hello" { true -> Name() otherwise -> "other" }
      let MethodBranch = when Show("hello").ToText() == "hello" { true -> "yes" otherwise -> "no" }
      view Card(Value Display) {
        Title Name()
        Subtitle Value.ToText()
      }
    `)
    const nodes = [...AST.streamAllContents(result.entry.ast)]
    const namedCalls = nodes.filter(AST.isFunctionCallExpression).filter(call => call.function.$refText === 'Name')
    Expect(namedCalls).toHaveLength(4)
    Expect(nodes.filter(AST.isMethodCallExpression)).toHaveLength(6)
    const show = result.entry.ast.statements.find(statement =>
      AST.isFunctionDeclaration(statement) && statement.name === 'Show'
    )
    Expect.Is(show, AST.isFunctionDeclaration)
    const direct = AST.returnStatementsOf(show)[0]?.value
    Expect.Is(direct, AST.isMethodCallExpression)
    Expect.Is(direct.callee, AST.isMemberAccessExpression)
    Expect(direct.callee.members).toEqual(['ToText'])
    Expect(direct.callee.target.ref).toBe(AST.parametersOf(show)[0])
    const read = result.entry.ast.statements.find(statement =>
      AST.isFunctionDeclaration(statement) && statement.name === 'Read'
    )
    Expect.Is(read, AST.isFunctionDeclaration)
    const pathCall = AST.returnStatementsOf(read)[0]?.value
    Expect.Is(pathCall, AST.isMethodCallExpression)
    Expect.Is(pathCall.callee, AST.isMemberAccessExpression)
    Expect(pathCall.callee.members).toEqual(['Inner', 'ToText'])
  })

  Test('lets method parameters shadow the contextual receiver and outer lexical values', async () => {
    const result = await testParseCode(`
      let FileValue = "outer"
      type FileValue is text with { func ToText() -> text { return FileValue } }
      type Token is text with { func ToText(Token text) -> text { return Token } }
      view Outer(Value text) {
        state Local = "outer state"
        type Local is text with { func ToText() -> text { return Local } }
        type Nested is text with { func ToText(Value text) -> text { return Value } }
      }
    `)
    const fileValue = result.entry.ast.statements.find(AST.isAliasDeclaration)
    const fileReturn = AST.returnStatementsOf(methodOf(namedType(result.entry.ast, 'FileValue')))[0]?.value
    Expect.Is(fileReturn, AST.isValueReference)
    Expect(fileReturn.target.ref).toBe(fileValue)
    Expect(AST.associatedReceiverOwner(fileReturn)).toBeUndefined()
    const tokenMethod = methodOf(namedType(result.entry.ast, 'Token'))
    const tokenReturn = AST.returnStatementsOf(tokenMethod)[0]?.value
    Expect.Is(tokenReturn, AST.isValueReference)
    Expect(tokenReturn.target.ref).toBe(AST.parametersOf(tokenMethod)[0])
    Expect(AST.associatedReceiverOwner(tokenReturn)).toBeUndefined()
    const outer = result.entry.ast.statements.find(AST.isViewDeclaration)
    Expect.Is(outer, AST.isViewDeclaration)
    const localType = AST.statementsOf(outer.block!).find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Local'
    )
    const nestedType = AST.statementsOf(outer.block!).find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Nested'
    )
    Expect.Is(localType, AST.isTypeDeclaration)
    Expect.Is(nestedType, AST.isTypeDeclaration)
    const local = AST.statementsOf(outer.block!).find(AST.isStateDeclaration)
    Expect.Is(local, AST.isStateDeclaration)
    const localReturn = AST.returnStatementsOf(methodOf(localType))[0]?.value
    Expect.Is(localReturn, AST.isValueReference)
    Expect(localReturn.target.ref).toBe(local)
    const nestedMethod = methodOf(nestedType)
    const nestedReturn = AST.returnStatementsOf(nestedMethod)[0]?.value
    Expect.Is(nestedReturn, AST.isValueReference)
    Expect(nestedReturn.target.ref).toBe(AST.parametersOf(nestedMethod)[0])
    Expect(nestedReturn.target.ref).not.toBe(AST.parametersOf(outer)[0])
  })

  Test('keeps persisted state modifiers separate from declared numeric constructors', async () => {
    const result = await testParseCode(`
      type PaneWidth is number
      app Workspace {
        id "com.tao.test.workspace"
        state Width is PaneWidth = PaneWidth 320 (persist)
      }
    `)
    const workspace = result.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(workspace, AST.isAppDeclaration)
    const state = workspace.block?.statements.find(AST.isStateDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    Expect(state.persist).toBe(true)
    Expect.Is(state.value, AST.isConfigurationConstructor)
    Expect(state.value.type.ref).toBe(namedType(result.entry.ast, 'PaneWidth'))
    Expect.Is(state.value.value, AST.isNumberLiteral)
    Expect(state.value.value.value).toBe(320)
    Expect([...AST.streamAllContents(state)].filter(AST.isMethodCallExpression)).toEqual([])
  })

  Test('starts a typed navigation block after scalar configuration values without a comma', async () => {
    const result = await testParseCode(`
      type StackNav is nav with { Initial scene }
      type ReusableApp is app with { name text is "Reusable" }
      let Product = ReusableApp {
        id "com.tao.test.product",
        version "1.0.0"
        Navigator StackNav { Initial Home }
      }
      let Variant = Product with {
        id "com.tao.test.variant"
        Navigator StackNav { Initial Home }
      }
      scene Home() { Title "Home" }
    `)
    const product = result.entry.ast.statements.find(AST.isAliasDeclaration)
    Expect.Is(product, AST.isAliasDeclaration)
    Expect.Is(product.value, AST.isConfigurationConstructor)
    const entries = product.value.block?.entries
    Expect(entries?.map(entry => entry.name)).toEqual(['id', 'version', 'Navigator'])
    const navigator = entries?.[2]
    Expect.Is(navigator, AST.isConfigurationEntry)
    Expect.Is(navigator.value, AST.isConfigurationConstructor)
    Expect(navigator.value.type.$refText).toBe('StackNav')
    Expect(navigator.value.type.ref?.name).toBe('StackNav')
    Expect(navigator.value.block?.entries[0]?.name).toBe('Initial')
    const variant = result.entry.ast.statements.find(statement =>
      AST.isAliasDeclaration(statement) && statement.name === 'Variant'
    )
    Expect.Is(variant, AST.isAliasDeclaration)
    Expect.Is(variant.value, AST.isRefinementExpression)
    Expect(variant.value.patchBlock.entries.map(entry => entry.name)).toEqual(['id', 'Navigator'])
    const variantNavigator = variant.value.patchBlock.entries[1]?.value
    Expect.Is(variantNavigator, AST.isConfigurationConstructor)
    Expect(variantNavigator.type.$refText).toBe('StackNav')
  })

  Test('keeps contextual receiver values out of ordinary functions and parameter defaults', async () => {
    const result = await parseCodeWithErrors(`
      type Token is text with {
        func ToText(Value text default Token) -> text { return Token }
      }
      func Outside() -> text { return Token }
      let OutsideMember = Token.ToText()
    `)
    Expect(result.entry.document.parseResult.parserErrors).toEqual([])
    const token = namedType(result.entry.ast, 'Token')
    const method = methodOf(token)
    const defaultValue = AST.parametersOf(method)[0]?.defaultValue
    Expect.Is(defaultValue, AST.isValueReference)
    Expect(defaultValue.target.ref).toBeUndefined()
    Expect(AST.associatedReceiverOwner(defaultValue)).toBeUndefined()
    const inside = AST.returnStatementsOf(method)[0]?.value
    Expect.Is(inside, AST.isValueReference)
    Expect(inside.target.ref).toBe(token)
    const outside = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(outside, AST.isFunctionDeclaration)
    const outsideReturn = AST.returnStatementsOf(outside)[0]?.value
    Expect.Is(outsideReturn, AST.isValueReference)
    Expect(outsideReturn.target.ref).toBeUndefined()
    const member = result.entry.ast.statements.find(AST.isAliasDeclaration)?.value
    Expect.Is(member, AST.isMethodCallExpression)
    Expect.Is(member.callee, AST.isMemberAccessExpression)
    Expect(member.callee.target.ref).toBe(token)
    Expect(AST.associatedReceiverOwner(member.callee.target)).toBeUndefined()
    Expect(
      result.diagnostics.filter(diagnostic => diagnostic.source === 'linker').map(diagnostic => diagnostic.message),
    )
      .toEqual([
        "No value named 'Token' is in scope.",
        "No value named 'Token' is in scope.",
      ])
  })

  Test('gives receiver identity only to methods in a declared type own body', async () => {
    const result = await parseCodeWithErrors(`
      type Outer is text with {
        func Wrap(Value { func Nested() -> text { return Outer } }) -> text { return Outer }
      }
      type Record is {
        Value text
        func ToText() -> text { return Record.Value }
      }
    `)
    Expect(result.entry.document.parseResult.parserErrors).toEqual([])
    const outer = namedType(result.entry.ast, 'Outer')
    const wrap = methodOf(outer)
    Expect(AST.associatedFunctionOwner(wrap)).toBe(outer)
    Expect(AST.associatedReceiverOwner(wrap)).toBeUndefined()
    const inlineType = AST.parametersOf(wrap)[0]?.inlineType?.type
    Expect.Is(inlineType, AST.isItemTypeExpression)
    const nested = inlineType.methods[0]
    Expect.Is(nested, AST.isAssociatedFunctionDeclaration)
    Expect(AST.associatedFunctionOwner(nested)).toBeUndefined()
    const nestedReturn = AST.returnStatementsOf(nested)[0]?.value
    Expect.Is(nestedReturn, AST.isValueReference)
    Expect(nestedReturn.target.ref).toBeUndefined()
    Expect(AST.associatedReceiverOwner(nestedReturn)).toBeUndefined()
    const wrapReturn = AST.returnStatementsOf(wrap)[0]?.value
    Expect.Is(wrapReturn, AST.isValueReference)
    Expect(wrapReturn.target.ref).toBe(outer)
    Expect(AST.associatedReceiverOwner(wrapReturn)).toBe(outer)
    const record = namedType(result.entry.ast, 'Record')
    Expect.Is(record.type, AST.isItemTypeExpression)
    const recordMethod = record.type.methods[0]
    Expect.Is(recordMethod, AST.isAssociatedFunctionDeclaration)
    Expect(AST.associatedFunctionOwner(recordMethod)).toBe(record)
    const recordReturn = AST.returnStatementsOf(recordMethod)[0]?.value
    Expect.Is(recordReturn, AST.isMemberAccessExpression)
    Expect(recordReturn.target.ref).toBe(record)
    Expect(AST.associatedReceiverOwner(recordReturn)).toBe(record)
  })

  Test('retains legacy function headers beside func headers', async () => {
    const result = await testParseCode(`
      function Legacy(Value text) returns text { return Value }
      func Current(Value text) fails never -> text { return Legacy(Value) }
      func Inferred(Value text) { return Value }
    `)
    const functions = result.entry.ast.statements.filter(AST.isFunctionDeclaration)
    Expect(functions.map(declaration => declaration.name)).toEqual(['Legacy', 'Current', 'Inferred'])
    Expect(functions[1]?.failureBound).toBe('never')
    Expect(functions[2]?.returnType).toBeUndefined()
  })

  Test(
    'requires capability results and keeps capability bodies out of anonymous type expressions',
    rejectsParser(`
    can Display { ToText() }
  `),
  )

  Test(
    'rejects a function body on a capability requirement',
    rejectsParser(`
    can Display { ToText() -> text { return "hello" } }
  `),
  )

  Test(
    'rejects an anonymous capability as a function parameter',
    rejectsParser(`
    func Show(Value can { ToText() -> text }) -> text { return "hello" }
  `),
  )

  Test(
    'rejects a bodyless method requirement in an anonymous record',
    rejectsParser(`
    func Show(Value { ToText() -> text }) -> text { return "hello" }
  `),
  )
})
