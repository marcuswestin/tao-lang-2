import { Describe, Expect, stubView, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: inverse Boolean writes', () => {
  Test('writes the complement into the one stored field', async () => {
    const compiled = await Compiler.compileCode(`
      data Notes / Note { Pinned yes / Unpinned no }
      action Change(Note) {
        update Note { Unpinned: true }
        update Note { Unpinned: false }
        update Note { Pinned: true }
      }
      app Inverse { id "inversewrites" version "1.0.0" name "Inverse" view Main }
      view Main { render Empty }
      ${stubView('Empty')}
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('["Pinned"]: TR.Unary(\'not\', TR.Value(true))')
    Expect(code).toContain('["Pinned"]: TR.Unary(\'not\', TR.Value(false))')
    Expect(code).toContain('["Pinned"]: TR.Value(true)')
    Expect(code).not.toContain('["Unpinned"]:')
  })
})
