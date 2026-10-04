import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: action failures', () => {
  Test('lowers native failures and foreign contracts to the transaction runtime', async () => {
    const compiled = await Compiler.compileCode(`
      app FailureApp { id "com.tao.test.failureapp" version "1.0.0" name "FailureApp"  view Main }
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
    Expect(code).toContain('{ runs: "latest", requiredArguments: 1, testStubKey: "')
  })

  Test('binds foreign action defaults before crossing the JavaScript boundary', async () => {
    const compiled = await Compiler.compileCode(`
      app DefaultsApp { id "com.tao.test.defaultsapp" version "1.0.0" name "DefaultsApp"  view Main }
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
    Expect(code).toContain('{ requiredArguments: 0, testStubKey: "')
  })

  Test('does not mark an outer action interruptible for a respond owned by a nested action value', async () => {
    const compiled = await Compiler.compileCode(`
      app RespondApp { id "com.tao.test.respondapp" version "1.0.0" name "RespondApp"  view Prompt }
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

  Test('marks an action interruptible when its detached async block can respond', async () => {
    const compiled = await Compiler.compileCode(`
      app RespondApp { id "com.tao.test.respondapp" version "1.0.0" name "RespondApp"  view Prompt }
      type Result is one of Done
      view Prompt() responds Result {
        action ReplyLater() { async { respond Done } }
        render Label("Ready")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('TR.Async(() =>')
    Expect(code).toContain('name: "ReplyLater", owner: _TaoActionOwner, interrupt: true')
  })
})
