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
})
