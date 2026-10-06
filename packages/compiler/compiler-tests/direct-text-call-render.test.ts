import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: direct text call renders', () => {
  Test('renders actual associated text call results at root and child occurrences', async () => {
    const compiled = await Compiler.compileCode(`
      use Col from @tao/ui
      type TitleType is text with {
        func TitleType.ToText() fails never -> text { return "converted" }
        view TitleType.Render() { render TitleType.ToText() }
      }
      app TextCalls { id "direct.text.calls" version "1.0.0" name "Direct text" view Main }
      view Caption(Title TitleType) { #root accessible label "Caption" render Title.ToText() [pad 8] }
      view Main {
        state Title = TitleType "raw"
        render Col {
          #child accessible label "Title" Title.ToText() [pad 4]
          Caption(Title)
          Title
        }
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code.match(/TR.RenderText\(TR.Call\(/g)).toHaveLength(3)
    Expect(code).toContain('["ToText"]')
    Expect(code).toContain('testTag: "root"')
    Expect(code).toContain('testTag: "child"')
    Expect(code).toContain('accessibilityLabel: TR.Value("Caption").evaluate().jsValue')
    Expect(code).toContain('accessibilityLabel: TR.Value("Title").evaluate().jsValue')
    Expect(code).toContain('TR.Design.Spec([["pad",8]])')
    Expect(code).toContain('TR.Design.Spec([["pad",4]])')
    Expect(code).toContain('TR.MountRendered(TR.Call<TR.Rendered>(')
  })
})
