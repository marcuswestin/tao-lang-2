import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: foreign views', () => {
  Test('adapts a named TSX export to Tao parameters and visual ambient props', async () => {
    const compiled = await Compiler.compileCode(`
      app ForeignApp { id "com.tao.test.foreignapp" version "1.0.0" name "ForeignApp"  view Main }
      view Main() {
        action Change(Value text) { }
        render CodeEditor("draft", Change) {
          @toolbar: Label("Tools")
          Label("Body")
        }
      }
      view CodeEditor(Content text, Change action(text))
        accepts content slots @toolbar from ./CodeEditor.tsx
      view Label(Value text) { render inject \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain("import { CodeEditor as __tao_foreign_view_CodeEditor__ } from './CodeEditor'")
    Expect(code).toContain('Content={_Scope.Content.evaluate().jsValue}')
    Expect(code).toContain('Change={_Scope.Change.evaluate().jsValue}')
    Expect(code).toContain('Layout={TR.VisualLayout(_ViewProps.__tao)}')
    Expect(code).toContain('Tag={TR.VisualTag(_ViewProps.__tao)}')
    Expect(code).toContain('Slots={_ViewProps.__taoSlots === undefined ? undefined : Object.fromEntries(')
    Expect(code).toContain(
      'React.createElement(TR.RenderSlots.Frame<Readonly<{}>>, { renderer: _TaoSlotRenderer, args: {} })',
    )
    Expect(code).toContain('{_ViewProps.children}')
  })
})
