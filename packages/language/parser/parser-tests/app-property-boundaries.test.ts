import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: app property expression boundaries', () => {
  for (const separator of ['\n', ' ']) {
    Test(
      `keeps adjacent reference-valued properties separate with ${separator === '\n' ? 'line' : 'space'} separators`,
      async () => {
        const parsed = await testParseCode(`
        let BookStore = "store"
        let LibraryDesign = "design"
        view Library() { }
        app Demo { Datasource BookStore${separator}Design LibraryDesign${separator}view Library }
      `)
        const app = parsed.entry.ast.statements.find(AST.isAppDeclaration)
        Expect.Is(app, AST.isAppDeclaration)
        const properties = AST.blockStatements(app).filter(AST.isAppProperty)
        Expect(properties.map(property => property.name)).toEqual(['Datasource', 'Design'])
        for (const [index, expected] of ['BookStore', 'LibraryDesign'].entries()) {
          const value = properties[index]!.value
          Expect.Is(value, AST.isValueReference)
          Expect(value.target.ref?.name).toBe(expected)
        }
        const root = AST.blockStatements(app).find(AST.isAppView)
        Expect.Is(root, AST.isAppView)
        Expect(root.view.ref?.name).toBe('Library')
      },
    )
  }

  Test('keeps a reference before a constructor-valued app property', async () => {
    const parsed = await testParseCode(`
      type CustomData is { StorageKey text }
      let MainNav = "navigation"
      app Demo {
        Navigator MainNav
        Datasource CustomData { StorageKey "demo" }
      }
    `)
    const app = parsed.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    const [navigator, datasource] = AST.blockStatements(app).filter(AST.isAppProperty)
    Expect.Is(navigator?.value, AST.isValueReference)
    Expect(navigator.value.target.ref?.name).toBe('MainNav')
    Expect.Is(datasource?.value, AST.isConfigurationConstructor)
    Expect(datasource.value.type.ref?.name).toBe('CustomData')
  })

  Test('retains literal inputs and grouped identifier constructor inputs inside app properties', async () => {
    const parsed = await testParseCode(`
      type Caption is text
      let Current = "value"
      app Demo { Label Caption "hello" Other (Caption Current) }
    `)
    const app = parsed.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    const properties = AST.blockStatements(app).filter(AST.isAppProperty)
    Expect(properties.map(property => property.name)).toEqual(['Label', 'Other'])
    for (const property of properties) {
      Expect.Is(property.value, AST.isConfigurationConstructor)
      Expect(property.value.type.ref?.name).toBe('Caption')
    }
    Expect.Is(properties[1]!.value, AST.isConfigurationConstructor)
    Expect.Is(properties[1]!.value.value, AST.isValueReference)
    Expect(properties[1]!.value.value.target.ref?.name).toBe('Current')
  })

  Test('keeps identifier construction in nested arguments and member payloads', async () => {
    const parsed = await testParseCode(`
      type Caption is text
      type Item is { Name text }
      let Current = "value"
      let Record = Item { Name: "member" }
      func Echo(Value text) -> text { return Value }
      let Ordinary = Caption Current
      app Demo {
        Nested Echo(Caption Current)
        Member Caption Record.Name
        Items [Caption Current]
        Number Caption "literal"
      }
    `)
    const app = parsed.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    const properties = AST.blockStatements(app).filter(AST.isAppProperty)
    Expect(properties.map(property => property.name)).toEqual(['Nested', 'Member', 'Items', 'Number'])
    Expect.Is(properties[0]!.value, AST.isFunctionCallExpression)
    const argument = AST.argumentsOf(properties[0]!.value)[0]
    Expect.Is(argument?.value, AST.isConfigurationConstructor)
    Expect.Is(properties[1]!.value, AST.isConfigurationConstructor)
    Expect.Is(properties[1]!.value.value, AST.isMemberAccessExpression)
    Expect.Is(properties[2]!.value, AST.isListLiteral)
    Expect.Is(properties[2]!.value.elements[0], AST.isConfigurationConstructor)
    const ordinary = parsed.entry.ast.statements.find(statement =>
      AST.isAliasDeclaration(statement) && statement.name === 'Ordinary'
    )
    Expect.Is(ordinary, AST.isAliasDeclaration)
    Expect.Is(ordinary.value, AST.isConfigurationConstructor)
  })

  Test('keeps references before literal-valued and keyword metadata properties', async () => {
    const parsed = await testParseCode(`
      let Store = "store"
      let Identifier = "com.tao.test.app"
      app Demo { Custom Store Other 7 id Identifier name "Demo" version "1.0.0" }
    `)
    const app = parsed.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    const properties = AST.blockStatements(app).filter(AST.isAppProperty)
    Expect(properties.map(property => property.name)).toEqual(['Custom', 'Other', 'id', 'name', 'version'])
    Expect.Is(properties[0]!.value, AST.isValueReference)
    Expect.Is(properties[2]!.value, AST.isValueReference)
  })
})
