import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: atomic event handlers', () => {
  Test('compiles an atomic do handler through the same action block as its braced spelling', async () => {
    const source = (handler: string) => `
      use Button from @tao/ui
      app AtomicEvent { id "atomic-event" name "AtomicEvent" version "1.0.0" view Main }
      view Main {
        state Presses = 0
        action Commit() { set Presses += 1 }
        render Button("Commit") { on press -> ${handler} }
      }
    `
    for (const statement of ['do Commit()', 'do Commit() then { done -> { set Presses += 1 } }']) {
      const atomic = await Compiler.compileCode(source(statement))
      const braced = await Compiler.compileCode(source(`{ ${statement} }`))
      Expect(atomic.code.replace(/\s+/g, '')).toBe(braced.code.replace(/\s+/g, ''))
    }
  })
})
