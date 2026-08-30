import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: host-read slots and commands', () => {
  Test('parses transparent nav aliases, declaration fills, commands, and toolbar journey steps', async () => {
    const result = await testParseSyntax(`
      use package @tao/nav/native as native
      public type StackNav = native.StackNav

      action Save(Value text) { Title "Save" }
      view Home(Title text) {
        state Enabled = false
        Title Title
        command SaveCommand = Save("draft") with {
          Label "Save"
          Enabled Enabled
          Icon when Enabled "checkmark" / not "circle"
        }
        Toolbar { SaveCommand }
        render Text()
      }

      app Demo { view Home }
      test Demo "host chrome" {
        run Demo
        expect navigation title "Home"
        expect toolbar command "Save" enabled
        press toolbar command "Save"
      }
    `)

    const alias = result.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(alias, AST.isTypeDeclaration)
    Expect(alias.aliasTarget?.member.$refText).toBe('StackNav')

    const home = result.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'Home',
    )
    Expect.Is(home, AST.isViewDeclaration)
    const fills = AST.declarationSlotFillsOf(home)
    Expect(fills.map(fill => fill.name)).toEqual(['Title', 'Toolbar'])
    Expect.Is(fills[1]?.block, AST.isDeclarationSlotReferenceBlock)

    const command = AST.commandsOf(home)[0]
    Expect.Is(command, AST.isCommandDeclaration)
    Expect(command.name).toBe('SaveCommand')
    Expect(command.metadata?.fills.map(fill => fill.name)).toEqual(['Label', 'Enabled', 'Icon'])
    Expect.Is(command.metadata?.fills[2]?.value, AST.isWhenExpression)

    const test = result.entry.ast.statements.find(AST.isTestDeclaration)
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.block.statements.map(statement => statement.$type)).toEqual([
      AST.RunStep.$type,
      AST.ExpectNavigationTitleStep.$type,
      AST.ExpectToolbarCommandStep.$type,
      AST.PressToolbarCommandStep.$type,
    ])
  })

  Test('resolves a same-named command intent to its action declaration', async () => {
    const result = await testParseCode(`
      action Share(Value text) { Title "Share" }
      view Home() {
        command Share = Share("link")
      }
    `)

    const action = result.entry.ast.statements.find(AST.isActionDeclaration)
    const home = result.entry.ast.statements.find(AST.isViewDeclaration)
    Expect.Is(action, AST.isActionDeclaration)
    Expect.Is(home, AST.isViewDeclaration)
    const command = AST.commandsOf(home)[0]
    Expect.Is(command, AST.isCommandDeclaration)
    Expect(command.action.ref).toBe(action)
  })
})
