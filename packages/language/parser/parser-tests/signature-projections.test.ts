import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

function parameter(functionDeclaration: AST.FunctionDeclaration, name: string): AST.ParameterDeclaration {
  const result = AST.parametersOf(functionDeclaration).find(item => item.inlineType?.name === name)
  Expect.Is(result, AST.isParameterDeclaration)
  return result
}

function parameterType(declaration: AST.ParameterDeclaration): AST.ParameterTypeDeclaration {
  Expect.Is(declaration.inlineType, AST.isParameterTypeDeclaration)
  return declaration.inlineType
}

function argumentConstructor(value: AST.Expression | undefined): AST.ConfigurationConstructor {
  Expect.Is(value, AST.isConfigurationConstructor)
  return value
}

Describe('parser: signature projections', () => {
  Test('projects bare and explicit relative arguments onto the real signature parameters', async () => {
    const result = await testParseCode(`
      func Subtract(Left number, Right number) { return Left - Right }
      let Difference = Subtract(Right 2, Left 5)
      let ExplicitDifference = Subtract(.Right 2, .Left 5)
      type LeftRole is Subtract.Left
    `)
    const file = result.entry.ast
    const subtract = file.statements.find(statement =>
      AST.isFunctionDeclaration(statement) && statement.name === 'Subtract'
    )
    Expect.Is(subtract, AST.isFunctionDeclaration)
    const left = parameterType(parameter(subtract, 'Left'))
    const right = parameterType(parameter(subtract, 'Right'))
    const leftRole = file.statements.find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'LeftRole'
    )
    Expect.Is(leftRole, AST.isTypeDeclaration)
    Expect.Is(leftRole.type, AST.isNamedTypeReference)
    Expect(leftRole.type.root).toBe('Subtract')
    Expect(leftRole.type.members).toEqual(['Left'])

    for (const name of ['Difference', 'ExplicitDifference']) {
      const alias = file.statements.find(statement => AST.isAliasDeclaration(statement) && statement.name === name)
      Expect.Is(alias, AST.isAliasDeclaration)
      Expect.Is(alias.value, AST.isFunctionCallExpression)
      Expect(alias.value.function.ref).toBe(subtract)
      const arguments_ = AST.argumentsOf(alias.value)
      const rightValue = argumentConstructor(arguments_[0]?.value)
      const leftValue = argumentConstructor(arguments_[1]?.value)
      Expect(rightValue.relative).toBe(name === 'ExplicitDifference')
      Expect(leftValue.relative).toBe(name === 'ExplicitDifference')
      Expect(rightValue.type.ref).toBe(right)
      Expect(leftValue.type.ref).toBe(left)
    }

    const returned = AST.returnStatementsOf(subtract)[0]?.value
    const references = [...AST.streamAllContents(returned!)].filter(AST.isValueReference)
    Expect(references).toHaveLength(2)
    Expect(references[0]?.target.ref).toBe(parameter(subtract, 'Left'))
    Expect(references[1]?.target.ref).toBe(parameter(subtract, 'Right'))
  })

  Test(
    'keeps relative projection distinct from a colliding visible type and preserves full function paths',
    async () => {
      const result = await testParseCode(`
      type Right is text
      func Subtract(Left number, Right number) { return Left - Right }
      let Bare = Subtract(Right 2, Left 5)
      let Relative = Subtract(.Right 2, .Left 5)
      let Full = Subtract.Right 2
    `)
      const file = result.entry.ast
      const type = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Right')
      const subtract = file.statements.find(statement =>
        AST.isFunctionDeclaration(statement) && statement.name === 'Subtract'
      )
      Expect.Is(type, AST.isTypeDeclaration)
      Expect.Is(subtract, AST.isFunctionDeclaration)
      const right = parameterType(parameter(subtract, 'Right'))
      const bare = file.statements.find(statement => AST.isAliasDeclaration(statement) && statement.name === 'Bare')
      const relative = file.statements.find(statement =>
        AST.isAliasDeclaration(statement) && statement.name === 'Relative'
      )
      const full = file.statements.find(statement => AST.isAliasDeclaration(statement) && statement.name === 'Full')
      Expect.Is(bare, AST.isAliasDeclaration)
      Expect.Is(relative, AST.isAliasDeclaration)
      Expect.Is(full, AST.isAliasDeclaration)
      Expect.Is(bare.value, AST.isFunctionCallExpression)
      Expect.Is(relative.value, AST.isFunctionCallExpression)
      const bareRight = argumentConstructor(AST.argumentsOf(bare.value)[0]?.value)
      const relativeRight = argumentConstructor(AST.argumentsOf(relative.value)[0]?.value)
      Expect(bareRight.relative).toBe(false)
      Expect(relativeRight.relative).toBe(true)
      Expect(bareRight.type.ref).toBe(type)
      Expect(relativeRight.type.ref).toBe(right)
      Expect.Is(full.value, AST.isConfigurationConstructor)
      Expect(full.value.type.ref).toBe(subtract)
      Expect(full.value.members).toEqual(['Right'])
    },
  )

  Test('does not resolve a relative argument through an enclosing signature', async () => {
    const result = await testParseSyntax(`
      func Inner(Other number) { return Other }
      func Outer(Role number) { return Role }
      let Nested = Outer(Inner(.Role 2))
    `)
    const relative = [...AST.streamAllContents(result.entry.ast)].find(
      node => AST.isConfigurationConstructor(node) && node.type.$refText === 'Role',
    )
    Expect.Is(relative, AST.isConfigurationConstructor)
    Expect(relative.type.ref).toBeUndefined()
  })

  Test('links imported signatures to private parameter types without leaking them into the caller', async () => {
    await withTaoFiles(
      'tao-signature-projections-',
      {
        'Main.tao': `
          use PersonName from ./Names
          let Full = PersonName(.GivenName "Ada", .FamilyName "Lovelace")
          let Bare = PersonName(GivenName "Ada", FamilyName "Lovelace")
          let Leak = GivenName "Ada"
          type ExportedGivenName is PersonName.GivenName
        `,
        'Names.tao': `
          file type GivenName is text
          file type FamilyName is text
          public func PersonName(GivenName, FamilyName) -> text {
            return GivenName
          }
        `,
      },
      async paths => {
        const result = await Workspace.parse(paths['Main.tao']!)
        const library = result.files.find(file => file.path === paths['Names.tao'])
        const main = result.entry.ast
        Expect(library).toBeDefined()
        Expect.Is(library!.ast, AST.isTaoFile)
        const givenName = library!.ast.statements.find(
          statement => AST.isTypeDeclaration(statement) && statement.name === 'GivenName',
        )
        const familyName = library!.ast.statements.find(
          statement => AST.isTypeDeclaration(statement) && statement.name === 'FamilyName',
        )
        const fullName = library!.ast.statements.find(
          statement => AST.isFunctionDeclaration(statement) && statement.name === 'PersonName',
        )
        Expect.Is(givenName, AST.isTypeDeclaration)
        Expect.Is(familyName, AST.isTypeDeclaration)
        Expect.Is(fullName, AST.isFunctionDeclaration)
        const exportedType = main.statements.find(
          statement => AST.isTypeDeclaration(statement) && statement.name === 'ExportedGivenName',
        )
        Expect.Is(exportedType, AST.isTypeDeclaration)
        Expect.Is(exportedType.type, AST.isNamedTypeReference)
        Expect(exportedType.type.root).toBe('PersonName')
        Expect(exportedType.type.members).toEqual(['GivenName'])

        for (const name of ['Full', 'Bare']) {
          const alias = main.statements.find(statement => AST.isAliasDeclaration(statement) && statement.name === name)
          Expect.Is(alias, AST.isAliasDeclaration)
          Expect.Is(alias.value, AST.isFunctionCallExpression)
          Expect(alias.value.function.ref).toBe(fullName)
          const arguments_ = AST.argumentsOf(alias.value)
          const givenValue = argumentConstructor(arguments_[0]?.value)
          const familyValue = argumentConstructor(arguments_[1]?.value)
          Expect(givenValue.relative).toBe(name === 'Full')
          Expect(familyValue.relative).toBe(name === 'Full')
          Expect(givenValue.type.ref).toBe(givenName)
          Expect(familyValue.type.ref).toBe(familyName)
        }

        const leak = main.statements.find(statement => AST.isAliasDeclaration(statement) && statement.name === 'Leak')
        Expect.Is(leak, AST.isAliasDeclaration)
        Expect.Is(leak.value, AST.isConfigurationConstructor)
        Expect(leak.value.type.ref).toBeUndefined()
        Expect(AST.visibleFileDeclarations(leak, AST.isTypeDeclaration).map(declaration => declaration.name))
          .not.toContain('GivenName')
      },
    )
  })
})
