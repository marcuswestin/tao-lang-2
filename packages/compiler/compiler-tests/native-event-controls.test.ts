import { Describe, Expect, stubContainer, stubView, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

const declarations = `
  ${stubContainer('Stack')}
  ${stubView('Button', 'Press action()')}
`

Describe('compiler: native event controls', () => {
  Test('decorates only the controlled binding and preserves a named action value', async () => {
    const compiled = await Compiler.compileCode(`
      app EventApp { id "eventapp" version "1.0.0" name "EventApp" view Main }
      ${declarations}
      view Main() {
        action Save() { }
        render Stack() {
          Button() { on press (preventDefault, stopPropagation) -> Save }
          Button() { on press Save }
        }
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain(
      'Press={TR.NativeEventControls(TR.BindEventAction(_Scope.Save.evaluate(), _TaoActionOwner), { preventDefault: true, stopPropagation: true }, _TaoActionOwner)}',
    )
    Expect(code).toContain('Press={TR.BindEventAction(_Scope.Save.evaluate(), _TaoActionOwner)}')
    Expect(code.match(/TR\.NativeEventControls\(/g)).toHaveLength(1)
    Expect(code).not.toContain('Save.nativeEvent')
  })

  Test('decorates an inline ordinary action without changing its owner or execution path', async () => {
    const compiled = await Compiler.compileCode(`
      app EventApp { id "eventapp" version "1.0.0" name "EventApp" view Main }
      ${declarations}
      view Main() {
        state Enabled = false
        render Button() { on press (stopPropagation) -> { toggle Enabled } }
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('Press={TR.NativeEventControls(TR.Action(')
    Expect(code).toContain('const _TaoActionContinuation = TR.ActionContinuation()')
    Expect(code).toContain('TR.BlockScope(_Scope,')
    Expect(code).toContain('{ owner: _TaoActionOwner,')
    Expect(code).toContain('stopPropagation: true')
    Expect(code).toContain('TR.Toggle(')
    Expect(code).toContain('), { stopPropagation: true }, _TaoActionOwner)')
  })

  Test('binds a controlled global action to the rendering owner without changing an uncontrolled binding', async () => {
    const compiled = await Compiler.compileCode(`
      app EventApp { id "eventapp" version "1.0.0" name "EventApp" view Main }
      ${declarations}
      action Save() { }
      view Main() {
        render Stack() {
          Button() { on press (preventDefault) -> Save }
          Button() { on press Save }
        }
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain(
      'Press={TR.NativeEventControls(TR.BindEventAction(_Scope.Save.evaluate(), _TaoActionOwner), { preventDefault: true }, _TaoActionOwner)}',
    )
    Expect(code).toContain('Press={TR.BindEventAction(_Scope.Save.evaluate(), _TaoActionOwner)}')
    Expect(code.match(/TR\.NativeEventControls\(/g)).toHaveLength(1)
  })
})
