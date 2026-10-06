import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: qualified text rendering', () => {
  Test('renders text members and member calls through Text with their layout', async () => {
    const result = await Compiler.compileCode(`
      use Col from @tao/ui
      app QualifiedText { id "qualified-text" name "QualifiedText" version "1.0.0" view Main }
      type ContentValue is { Content text }
      type Token is text with {
        func Label() fails never -> text { return Token }
      }
      view Main() {
        let Value = ContentValue { Content: "member" }
        let TokenValue = Token "method"
        render Col {
          ValueRender(Value)
          TokenRender(TokenValue)
          Plain(Value.Content)
        }
      }
      view ValueRender(Value ContentValue) {
        render Value.Content [pad 8]
      }
      view TokenRender(TokenValue Token) {
        render TokenValue.Label() [pad 12]
      }
      view Plain(Value text) {
        render Value
      }
    `)

    Expect(result.code).toContain('Text as __tao_quoted_Text$')
    Expect(result.code).toContain('TR.RenderText(TR.Member(_Scope.Value.evaluate(), ["Content"])')
    Expect(result.code).toContain('TR.RenderText(TR.Call(__tao_associated_witness_1__["Label"]')
    Expect(result.code.replace(/\s+/g, '')).toContain('TR.Design.Spec([["pad",8]])')
    Expect(result.code.replace(/\s+/g, '')).toContain('TR.Design.Spec([["pad",12]])')
    Expect(result.code).toContain('Plain(')
    Expect(result.code).toContain('TR.RenderText(_Scope.Value.evaluate()')
  })
})
