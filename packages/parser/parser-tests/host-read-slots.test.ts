import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: host-read slots and commands', () => {
  Test('parses transparent nav aliases, declaration fills, commands, and toolbar journey steps', async () => {
    const result = await testParseSyntax(`
      use package @tao/nav/native as native
      public type StackNav = native.StackNav

      action Save(Value text) { }
      scene Home(Title text) {
        state Enabled = false
        Title Title
        command SaveCommand {
          Label "Save"
          Enabled Enabled is not empty
          Icon when Enabled "checkmark" / not "circle"
          do Save("draft")
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
    Expect(AST.commandEntriesOf(command).map(entry => entry.name)).toEqual(['Label', 'Enabled', 'Icon'])
    Expect.Is(AST.commandEntriesOf(command)[2]?.value, AST.isWhenExpression)
    Expect(AST.commandDoClauseOf(command)?.action).toBeDefined()

    const test = result.entry.ast.statements.find(AST.isTestDeclaration)
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.block.statements.map(statement => statement.$type)).toEqual([
      AST.RunStep.$type,
      AST.ExpectNavigationTitleStep.$type,
      AST.ExpectToolbarCommandStep.$type,
      AST.PressToolbarCommandStep.$type,
    ])
  })

  Test('resolves a same-named command to the action its do clause runs', async () => {
    const result = await testParseCode(`
      action Share(Value text) { }
      view Home() {
        command Share {
          Title "Share"
          do Share("link")
        }
      }
    `)

    const action = result.entry.ast.statements.find(AST.isActionDeclaration)
    const home = result.entry.ast.statements.find(AST.isViewDeclaration)
    Expect.Is(action, AST.isActionDeclaration)
    Expect.Is(home, AST.isViewDeclaration)
    const command = AST.commandsOf(home)[0]
    Expect.Is(command, AST.isCommandDeclaration)
    const target = AST.commandDoClauseOf(command)?.action
    Expect.Is(target, AST.isValueReference)
    Expect(target.target.ref).toBe(action)
  })

  Test('reads a bare slot beside a member fill without either swallowing the other', async () => {
    const result = await testParseCode(`
      data Documents / Document {
        Title text
        Final yes / Draft no
      }

      command Finish {
        Document
        Title "Finish document"
        Enabled Document.Final is Draft
        do -> {
          update Document { Final }
        }
      }
    `)

    const command = result.entry.ast.statements.find(AST.isCommandDeclaration)
    Expect.Is(command, AST.isCommandDeclaration)
    const entries = AST.commandEntriesOf(command)
    Expect(entries.map(entry => entry.name)).toEqual(['Document', 'Title', 'Enabled'])
    Expect(entries.map(entry => entry.value === undefined)).toEqual([true, false, false])
    Expect(AST.commandSlotCandidatesOf(command).map(entry => entry.name)).toEqual(['Document'])
  })
})
