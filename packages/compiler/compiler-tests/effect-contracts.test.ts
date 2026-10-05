import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

const app = `
  app Contracts { id "com.tao.test.contracts" version "1.0.0" name "Contracts" view Main }
  view Empty() { render inject \`\`\`ts return null \`\`\` }
  type Failure is one of Offline, TooLarge
`

Describe('compiler: effect contracts', () => {
  Test('keeps known cases beside the open remainder of a named dynamic wrapper', async () => {
    const compiled = await Compiler.compileCode(`${app}
      view Main() {
        action Wrapper(Callback action(), Stop boolean) {
          if Stop { fail Offline "Offline sentence." }
          do Callback()
        }
        action Run(Callback action()) {
          when do Wrapper(Callback, false) { Offline -> { } rejected -> { } error -> { } }
        }
        render Empty()
      }
    `)

    Expect(compiled.code.replace(/\s+/g, ' ')).toContain(
      '{ name: "Wrapper", declared: ["Offline"], open: true, }',
    )
  })

  Test('retains an open remainder after a named wrapper handles only its known case', async () => {
    const compiled = await Compiler.compileCode(`${app}
      action Publish() from ./Bindings.ts
      action Known() { fail Offline "Offline sentence." }
      action Combined() { do Known() do Publish() }
      action Partial() { when do Combined() { Offline -> { } } }
      view Main() {
        action Run() { when do Partial() { rejected -> { } error -> { } } }
        render Empty()
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('{ name: "Combined", declared: ["Offline"], open: true, }')
    Expect(code).toContain('{ name: "Partial", declared: [], open: true, }')
  })

  Test('preserves open foreign failures through a joined result binding', async () => {
    const compiled = await Compiler.compileCode(`${app}
      action Read() returns text from ./Bindings.ts
      action ReadAndDiscard() { let Value = do Read() }
      view Main() {
        action Run() { when do ReadAndDiscard() { rejected -> { } error -> { } } }
        render Empty()
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('_Scope.Value = await TR.DoResult<string>(_Scope.Read.evaluate())')
    Expect(code).toContain('{ name: "ReadAndDiscard", declared: [], open: true, }')
  })

  Test('keeps recursive uncertainty open while retaining a reachable known case', async () => {
    const compiled = await Compiler.compileCode(`${app}
      action First() { do Second() }
      action Second() { do First() fail TooLarge "TooLarge sentence." }
      view Main() {
        action Run() { when do First() { rejected -> { } error -> { } } }
        render Empty()
      }
    `)

    Expect(compiled.code.replace(/\s+/g, ' ')).toContain(
      '{ name: "First", declared: ["TooLarge"], open: true, }',
    )
  })

  Test('keeps a detached open call separate from the launching action contract', async () => {
    const compiled = await Compiler.compileCode(`${app}
      action Publish() from ./Bindings.ts
      action Launch() { async { when do Publish() { rejected -> { } error -> { } } } }
      view Main() {
        action Run() { when do Launch() { saved -> { } } }
        render Empty()
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('TR.Async(() =>')
    Expect(code).toContain('{ name: "Publish", declared: [], open: true, }')
    Expect(code).toContain('{ name: "Launch", declared: [], }')
  })
})
