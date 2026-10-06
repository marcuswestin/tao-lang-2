import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: bare text rendering', () => {
  Test('imports the real standard Text view for a text root without an authored UI import', async () => {
    const result = await Compiler.compileCode(`
      app BareTextRoot { id "bare-text-root" name "BareTextRoot" version "1.0.0" view Main }
      view Main {
        let Message = "Visible root"
        render Message
      }
    `)
    const ownFile = result.validation.files.find(file =>
      file.ast.statements.some(statement => AST.isAppDeclaration(statement) && statement.name === 'BareTextRoot')
    )!
    const main = ownFile.ast.statements.find(AST.isViewDeclaration)!
    const alias = main.block!.statements.find(AST.isAliasDeclaration)!
    const render = main.block!.statements.find(AST.isRenderStatement)!
    Expect(render.view!.ref).toBe(alias)
    Expect(alias.name).toBe('Message')
    Expect(result.code).toContain('Text as __tao_quoted_Text$')
    Expect(result.code).toContain('TR.RenderText(_Scope.Message.evaluate()')
    Expect(result.files.some(file => file.code.includes("ellipsizeMode: 'tail'"))).toBe(true)
  })

  Test('keeps state alias and parameter references and their actual occurrence props', async () => {
    const result = await Compiler.compileCode(`
      use Col, Text from @tao/ui
      app BareTextValues { id "bare-text-values" name "BareTextValues" version "1.0.0" view Main }
      view Main {
        state Feedback = "Ready"
        let Caption = Feedback
        render Col {
          #state accessible label "State occurrence" Feedback [pad 8]
          #alias Caption
          Child(Caption)
          #quoted ""
          #explicit Text("")
        }
      }
      view Child(Value text) {
        render Value
      }
    `)
    Expect(result.code).toContain('TR.RenderText(_Scope.Feedback')
    Expect(result.code).toContain('TR.RenderText(_Scope.Caption.evaluate()')
    Expect(result.code).toContain('TR.RenderText(_Scope.Value.evaluate()')
    Expect(result.code).toContain('testTag: "state"')
    Expect(result.code).toContain('State occurrence')
    Expect(result.code.replace(/\s+/g, '')).toContain('TR.Design.Spec([["pad",8]])')
    Expect(result.code).toContain('testTag: "quoted"')
    Expect(result.code).toContain('testTag: "explicit"')
  })
})
