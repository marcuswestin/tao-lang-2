import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: operator methods and conversions', () => {
  Test('parses static operator methods without changing their signatures or bodies', async () => {
    const result = await testParseSyntax(`
      type NumberBox is number with {
        static func + where type T is Self (Value T) fails never -> T { return Value }
        func -() -> number { return 1 }
        func *() -> number { return 1 }
        func /() -> number { return 1 }
        func ==() -> boolean { return true }
        func !=() -> boolean { return true }
        func <() -> boolean { return true }
        func <=() -> boolean { return true }
        func >() -> boolean { return true }
        func >=() -> boolean { return true }
      }
    `)
    const declaration = result.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(declaration, AST.isTypeDeclaration)
    Expect.Is(declaration.type, AST.isDerivedTypeExpression)
    const methods = declaration.type.slots.methods
    Expect(methods.map(method => method.name)).toEqual(['+', '-', '*', '/', '==', '!=', '<', '<=', '>', '>='])
    Expect(methods.map(method => method.static)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    const addition = methods[0]
    Expect.Is(addition, AST.isAssociatedFunctionDeclaration)
    Expect(addition.genericParameters.map(parameter => parameter.name)).toEqual(['T'])
    Expect(AST.parametersOf(addition).map(parameter => parameter.inlineType?.name)).toEqual(['Value'])
    Expect(addition.failureBound).toBe('never')
    Expect.Is(addition.returnType, AST.isNamedTypeReference)
    Expect(addition.returnType.root).toBe('T')
    Expect(AST.returnStatementsOf(addition).map(statement => statement.value.$type)).toEqual([AST.ValueReference.$type])
  })

  Test('groups as conversions over arithmetic and independently on comparison operands', async () => {
    const result = await testParseSyntax(`
      let ArithmeticResult = 1 + 2 as number
      let Compared = 1 as number < 2 + 3 as number
      scene Example(Title text) {
        Title 4 + 5 as number < 10
      }
    `)
    const arithmetic = result.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'ArithmeticResult',
    )
    Expect.Is(arithmetic, AST.isAliasDeclaration)
    Expect.Is(arithmetic.value, AST.isConversionExpression)
    Expect.Is(arithmetic.value.value, AST.isBinaryExpression)
    Expect(arithmetic.value.value.operator).toBe('+')
    Expect.Is(arithmetic.value.target, AST.isPrimitiveTypeReference)

    const compared = result.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'Compared',
    )
    Expect.Is(compared, AST.isAliasDeclaration)
    Expect.Is(compared.value, AST.isBinaryExpression)
    Expect(compared.value.operator).toBe('<')
    Expect.Is(compared.value.left, AST.isConversionExpression)
    Expect.Is(compared.value.right, AST.isConversionExpression)
    Expect.Is(compared.value.right.value, AST.isBinaryExpression)
    Expect(compared.value.right.value.operator).toBe('+')

    const scene = result.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'Example',
    )
    Expect.Is(scene, AST.isViewDeclaration)
    const title = AST.declarationSlotFillsOf(scene).find(fill => fill.name === 'Title')
    Expect.Is(title?.value, AST.isBinaryExpression)
    Expect(title.value.operator).toBe('<')
    Expect.Is(title.value.left, AST.isConversionExpression)
  })

  Test('parses yes and no as boolean literals and declared-constructor values', async () => {
    const result = await testParseSyntax(`
      type Flag is boolean
      let Affirmative = yes
      let Negative = no
      let Constructed = Flag yes
    `)
    const declaration = (name: string): AST.AliasDeclaration => {
      const alias = result.entry.ast.statements.find(
        statement => AST.isAliasDeclaration(statement) && statement.name === name,
      )
      Expect.Is(alias, AST.isAliasDeclaration)
      return alias
    }

    Expect.Is(declaration('Affirmative').value, AST.isBooleanLiteral)
    Expect(declaration('Affirmative').value.value).toBe('yes')
    Expect.Is(declaration('Negative').value, AST.isBooleanLiteral)
    Expect(declaration('Negative').value.value).toBe('no')
    const constructed = declaration('Constructed').value
    Expect.Is(constructed, AST.isConfigurationConstructor)
    Expect.Is(constructed.value, AST.isBooleanLiteral)
    Expect(constructed.value.value).toBe('yes')
  })

  Test('parses operator names in capability signatures and associated converters', async () => {
    const result = await testParseSyntax(`
      type Source is number
      type Target is text
      can Operators { +(Left number, Right number) -> number }
      type Convert is {
        Source as Target fails never { return Target("converted") }
      }
    `)
    const capability = result.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Operators',
    )
    Expect.Is(capability, AST.isTypeDeclaration)
    Expect.Is(capability.type, AST.isCapabilityTypeExpression)
    Expect(capability.type.methods.map(method => method.name)).toEqual(['+'])

    const convert = result.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Convert',
    )
    Expect.Is(convert, AST.isTypeDeclaration)
    Expect.Is(convert.type, AST.isItemTypeExpression)
    Expect(convert.type.converters).toHaveLength(1)
    const converter = convert.type.converters[0]
    Expect.Is(converter, AST.isAssociatedConverterDeclaration)
    Expect.Is(converter.conversionSource, AST.isNamedTypeReference)
    Expect(converter.conversionSource.root).toBe('Source')
    Expect.Is(converter.conversionTarget, AST.isNamedTypeReference)
    Expect(converter.conversionTarget.root).toBe('Target')
    Expect(converter.failureBounds).toEqual(['never'])
    const returned = AST.returnStatementsOf(converter)[0]?.value
    Expect.Is(returned, AST.isFunctionCallExpression)
  })

  Test('keeps a grouped same-name nav value separate from the following datasource slot', async () => {
    const result = await testParseSyntax(`
      type CustomStack is nav
      nav CustomStack = CustomStack { }
      type SnapshotStore is datasource
      datasource SnapshotStore = SnapshotStore { }
      app Demo { Navigator (CustomStack) Datasource SnapshotStore { StorageKey "demo" } }
    `)
    const app = result.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    const statements = app.block?.statements ?? []
    const navigator = statements.find(statement => AST.isAppProperty(statement) && statement.name === 'Navigator')
    const datasource = statements.find(statement => AST.isAppProperty(statement) && statement.name === 'Datasource')
    Expect.Is(navigator, AST.isAppProperty)
    Expect.Is(navigator.value, AST.isValueReference)
    const nav = result.entry.ast.statements.find(
      statement => AST.isNavDeclaration(statement) && statement.name === 'CustomStack',
    )
    Expect.Is(nav, AST.isNavDeclaration)
    Expect(navigator.value.target.ref).toBe(nav)
    Expect.Is(datasource, AST.isAppProperty)
    Expect.Is(datasource.value, AST.isConfigurationConstructor)
    Expect(datasource.value.type.$refText).toBe('SnapshotStore')
  })
})
