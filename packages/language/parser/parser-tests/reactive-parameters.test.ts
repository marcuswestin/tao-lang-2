import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: reactive parameters', () => {
  Test('parses mutually exclusive copy and mutable parameter modifiers with writable field paths', async () => {
    const parsed = await testParseCode(`
      view Editor(copy Draft text, mutable Value text) from ./Editor.tsx
      view Form(Value text) {
        state Draft = Value
        action Save() { set Draft.Title = Value }
      }
    `)
    const editor = parsed.entry.ast.statements.find(AST.isViewDeclaration)
    Expect.Is(editor, AST.isViewDeclaration)
    Expect(editor.parameterList!.parameters[0]!.copy).toBe(true)
    Expect(editor.parameterList!.parameters[1]!.mutable).toBe(true)
    const form = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Form'
    )!
    Expect.Is(form, AST.isViewDeclaration)
    const action = form.block!.statements.find(AST.isActionDeclaration)!
    Expect.Is(action, AST.isActionDeclaration)
    const set = action.block!.statements[0]!
    Expect.Is(set, AST.isSetStatement)
    Expect(set.members).toEqual(['Title'])
  })
})
