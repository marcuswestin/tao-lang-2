import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: typed text field', () => {
  Test('keeps the nominal caller field lens and its required validation', async () => {
    const compiled = await Compiler.compileCode(`
      use Col, TextField from @tao/ui
      type TitleType is text
      data Books / Book { Title TitleType (required "Enter a title"), Note text }
      type NewBook is Book { Title }
      app Form { id "typed.text.field" version "1.0.0" name "Typed form" view Main }
      view Main {
        state Draft = NewBook { Title: TitleType "" }
        render Col {
          #title TextField(.Value Draft.Title)
          "{Draft.Title}"
          "{Draft.Incomplete}"
        }
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('<_Scope.TextField Value={(TR.Member(_Scope.Draft, ["Title"]) as TR.Writable<any>)}')
    Expect(code).toContain('TR.Incomplete(_Scope.Draft.evaluate(), [["Title", "Enter a title"]])')
    const field = compiled.files.find(file => file.code.includes('function TextField'))
    Expect(field).toBeDefined()
    Expect(field!.code).toContain('_TaoNative_Value.set(TR.Value(next))')
    Expect(compiled.files.some(file =>
      file.relativePath.endsWith('TextField.tao.injection-1.tsx')
      && file.code.includes('TR.Views.TextInput(')
    )).toBe(true)
  })
})
