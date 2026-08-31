import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: action failures', () => {
  Test('lowers native failures and foreign contracts to the transaction runtime', async () => {
    const compiled = await Compiler.compileCode(`
      app FailureApp { view Main }
      type SaveFailure is one of Offline
      action Save() { fail Offline "Could not save." }
      view Main() {
        action Publish(Value text) runs latest fails Offline "Unavailable." from ./Api.ts
        render Label("Ready")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('TR.Fail(_Scope.SaveFailure.Offline, "Could not save.")')
    Expect(code).toContain("import { Publish as __tao_foreign_action_Publish_1__ } from './Api'")
    Expect(code).toContain('TR.ForeignAction( __tao_foreign_action_Publish_1__, "Publish"')
    Expect(code).toContain('sentence: "Unavailable."')
    Expect(code).toContain('{ runs: "latest" }')
  })

  Test('binds foreign action defaults before crossing the JavaScript boundary', async () => {
    const compiled = await Compiler.compileCode(`
      app DefaultsApp { view Main }
      view Main() {
        action Publish(Title text default "Untitled", Copies number default 1) from ./Api.ts
        render Label("Ready")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('_TaoActionArg0 == null ? TR.Value("Untitled") : TR.Value(_TaoActionArg0)')
    Expect(code).toContain('_TaoActionArg1 == null ? TR.Value(1) : TR.Value(_TaoActionArg1)')
    Expect(code).toContain(
      '__tao_foreign_action_Publish_1__(_Scope.Title.evaluate().jsValue, _Scope.Copies.evaluate().jsValue)',
    )
  })

  Test('does not mark an outer action interruptible for a respond owned by a nested action value', async () => {
    const compiled = await Compiler.compileCode(`
      app RespondApp { view Prompt }
      type Result is one of Done
      view Prompt() responds Result {
        action Outer() { do action { respond Done }() }
        render Label("Ready")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code.match(/interrupt: true/g)).toHaveLength(1)
  })
})
