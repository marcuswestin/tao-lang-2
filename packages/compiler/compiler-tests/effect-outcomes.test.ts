import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: effect outcomes', () => {
  Test('lets handled responses and cancellations interrupt their suspended ask', async () => {
    const compiled = await Compiler.compileCode(`
      app OutcomeApp { id "com.tao.test.outcomeapp" version "1.0.0" name "OutcomeApp"  view Main }
      type Answer is one of Confirmed
      view Main() { render Dialogue() }
      view Dialogue() responds Answer {
        action Reply() { respond Confirmed }
        action Cancel() { dismiss }
        action HandledReply() { when do Reply() { saved -> { } } }
        action HandledCancel() { when do Cancel() { saved -> { } } }
        action CycleA() { when do CycleB() { saved -> { } } }
        action CycleB() { do CycleA() }
        render Label("Ready")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)

    Expect(compiled.code.match(/interrupt: true/g)).toHaveLength(4)
  })

  Test('lowers when do to the contained runtime with the verb effective contract', async () => {
    const compiled = await Compiler.compileCode(`
      app OutcomeApp { id "com.tao.test.outcomeapp" version "1.0.0" name "OutcomeApp"  view Main }
      type ExportFailure is one of Offline, TooLarge
      type SaveFailure is one of Full
      action Save() { fail Full "The disk is full." }
      action SaveAndExport() {
        do Save()
        when do Publish() { Offline -> { } }
      }
      action Publish()
        fails Offline "Publishing needs a connection."
        fails TooLarge "This is too long to publish."
        from ./Api.ts
      view Main() {
        state Failure = ""
        action Run() {
          when do SaveAndExport() {
            saved -> { set Failure = "" }
            rejected -> Problem { set Failure = Problem }
          }
        }
        render Label("Ready")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    // The contract is transitive: `Full` arrives through a plain `do`, `Offline` is handled inside.
    Expect(code).toContain(
      'await TR.WhenDo(() => TR.Do(_Scope.SaveAndExport.evaluate()), { name: "SaveAndExport", declared: ["Full", "TooLarge"], }',
    )
    Expect(code).toContain(
      '["rejected", async _TaoCasePayload => TR.BlockScope(_Scope, async _Scope => { _Scope.Problem = _TaoCasePayload',
    )
    Expect(code).toContain('_Scope.Run = TR.Action(async () =>')
  })
  Test('marks a dynamic verb contract unknown rather than empty', async () => {
    const compiled = await Compiler.compileCode(`
      app OutcomeApp { id "com.tao.test.outcomeapp" version "1.0.0" name "OutcomeApp"  view Main }
      view Main() {
        state Failure = ""
        action Run(Callback action()) {
          when do Callback() { rejected -> Problem { set Failure = Problem } }
        }
        render Label("Ready")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('{ name: "Callback", declared: [], open: true, }')
  })
})
