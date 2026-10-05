import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST, Parser, URI } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('signature role type projections', () => {
  Test('projects private named parameter types across an exported signature', async () => {
    await withTaoFiles('tao-signature-role-projection-', {
      'Names.tao': `
        file type GivenName is text
        file type Surname is text
        public func PersonName(GivenName, Surname) -> text { return GivenName + Surname }
        public func Identity(Value GivenName) -> text { return Value }
      `,
      'Main.tao': `
        use PersonName, Identity from ./Names
        type First is PersonName.GivenName
        type Inline is Identity.Value
        let Name = PersonName.GivenName "Ada"
        let Renamed = Identity.Value "Grace"
      `,
    }, async (paths, root) => {
      const context = Parser.createContext({ packages: Packages.createResolver(await Packages.createContext(root)) })
      const parsed = await Parser.parse(context, URI.file(paths['Main.tao']))
      Expect(parsed.diagnostics).toEqual([])
      const types = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
      const aliases = parsed.entry.ast.statements.filter(AST.isAliasDeclaration)
      const first = types.find(type => type.name === 'First')
      const inline = types.find(type => type.name === 'Inline')
      Expect.Is(first, AST.isTypeDeclaration)
      Expect.Is(inline, AST.isTypeDeclaration)
      Expect.Is(first.type, AST.isNamedTypeReference)
      Expect.Is(inline.type, AST.isNamedTypeReference)
      const name = aliases.find(alias => alias.name === 'Name')
      const renamed = aliases.find(alias => alias.name === 'Renamed')
      Expect.Is(name, AST.isAliasDeclaration)
      Expect.Is(renamed, AST.isAliasDeclaration)
      Expect.Is(name.value, AST.isConfigurationConstructor)
      Expect.Is(renamed.value, AST.isConfigurationConstructor)
      const personName = name.value.type.ref
      const identity = renamed.value.type.ref
      Expect.Is(personName, AST.isFunctionDeclaration)
      Expect.Is(identity, AST.isFunctionDeclaration)
      const givenName = AST.parametersOf(personName)[0]?.type
      Expect.Is(givenName, AST.isNamedTypeReference)
      const privateDefinition = Type.definitionOfReference(givenName)
      Expect.Is(privateDefinition, AST.isTypeDeclaration)
      Expect(privateDefinition.name).toBe('GivenName')
      Expect(Type.signatureParameterDefinition(personName, 'GivenName') === privateDefinition).toBe(true)
      Expect(Type.definitionOfReference(first.type) === privateDefinition).toBe(true)
      Expect(Type.displayName(Type.ofConfiguredValue(name.value))).toBe('GivenName')
      const inlineRole = AST.parametersOf(identity)[0]?.inlineType
      Expect.Is(inlineRole, AST.isParameterTypeDeclaration)
      Expect(Type.signatureParameterDefinition(identity, 'Value') === inlineRole).toBe(true)
      Expect(Type.definitionOfReference(inline.type) === inlineRole).toBe(true)
      Expect(Type.displayName(Type.ofConfiguredValue(renamed.value))).toBe('GivenName')
      const constructedTypes = [Type.ofConfiguredValue(name.value), Type.ofConfiguredValue(renamed.value)]
      Expect(constructedTypes.every(type => type.kind === 'primitive' && type.nominal === privateDefinition)).toBe(true)
      const descendant = Type.ofDefinition(first)
      Expect(descendant.kind === 'primitive' && descendant.nominal === first).toBe(true)
      Expect(Type.displayName(Type.ofDefinition(first))).toBe('First')
      Expect(Type.isAssignable(Type.ofDefinition(first), Type.ofDefinition(privateDefinition))).toBe(true)
      Expect(Type.isAssignable(Type.ofDefinition(privateDefinition), Type.ofDefinition(first))).toBe(false)
      Expect(Type.displayName(Type.ofDefinition(inline))).toBe('Inline')
      Expect(Type.signatureParameterDefinition(personName, 'Absent')).toBeUndefined()
    })
  })

  Test('retains distinct inline primitive roles through out-of-order argument binding', async () => {
    const parsed = await Parser.parseCode(`
      func Subtract(Left number, Right number) -> number { return Left - Right }
      let Result = Subtract(Subtract.Right 2, Subtract.Left 5)
    `)
    Expect(parsed.diagnostics).toEqual([])
    const subtract = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    const result = parsed.entry.ast.statements.find(AST.isAliasDeclaration)
    Expect.Is(subtract, AST.isFunctionDeclaration)
    Expect.Is(result, AST.isAliasDeclaration)
    Expect.Is(result.value, AST.isFunctionCallExpression)
    const parameters = AST.parametersOf(subtract)
    const left = parameters[0]?.inlineType
    const right = parameters[1]?.inlineType
    Expect.Is(left, AST.isParameterTypeDeclaration)
    Expect.Is(right, AST.isParameterTypeDeclaration)
    Expect(Type.signatureParameterDefinition(subtract, 'Left') === left).toBe(true)
    Expect(Type.signatureParameterDefinition(subtract, 'Right') === right).toBe(true)
    Expect(Type.identityKey(Type.ofDefinition(left)) === Type.identityKey(Type.ofDefinition(right))).toBe(false)
    const binding = ASTUtils.resolveFunctionInvocation(result.value)
    Expect(binding.diagnostics).toEqual([])
    Expect(binding.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Left', 'Right'])
    Expect(binding.pairs.map(pair => AST.argumentsOf(result.value).indexOf(pair.argument))).toEqual([1, 0])
  })

  Test('resolves contextual inline constructors through their real parameter type declaration', async () => {
    const parsed = await Parser.parseCode(`
      func Subtract(Left number, Right number) -> number { return Left - Right }
      let One = Subtract(.Right 2, .Left 1)
    `)
    Expect(parsed.diagnostics).toEqual([])
    const subtract = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(subtract, AST.isFunctionDeclaration)
    const one = parsed.entry.ast.statements.find(AST.isAliasDeclaration)
    Expect.Is(one, AST.isAliasDeclaration)
    Expect.Is(one.value, AST.isFunctionCallExpression)
    const constructor = AST.argumentsOf(one.value)[1]?.value
    Expect.Is(constructor, AST.isConfigurationConstructor)
    const left = AST.parametersOf(subtract)[0]?.inlineType
    Expect.Is(left, AST.isParameterTypeDeclaration)
    Expect(constructor.type.ref === left).toBe(true)
    Expect(Type.displayName(Type.ofConfiguredValue(constructor))).toBe('Subtract.Left')
  })

  Test('leaves recursive short-form signature projections unresolved', async () => {
    const parsed = await Parser.parseCode(`
      func First(Second.Value) -> text { return "" }
      func Second(First.Value) -> text { return "" }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const first = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(first, AST.isFunctionDeclaration)
    Expect(Type.signatureParameterDefinition(first, 'Value')).toBeUndefined()
    Expect(Type.ofParameter(AST.parametersOf(first)[0]!).kind).toBe('unresolved')
  })
})
