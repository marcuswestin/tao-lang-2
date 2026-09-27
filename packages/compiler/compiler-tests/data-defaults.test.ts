import { Describe, Expect, stubView, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: data defaults', () => {
  Test('stores enum defaults as declared case names while preserving boolean case defaults', async () => {
    const compiled = await Compiler.compileCode(`
      type Role is one of Reader, Editor
      data Notes / Note {
        Role (default Reader),
        OptionalRole Role?,
        Public yes / Private no (default Public),
        Pinned yes / Unpinned no (default Unpinned)
      }
      app Defaults { view Main }
      view Main() { render Empty() }
      ${stubView('Empty')}
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toMatch(
      /\["Role"\]: \{ kind: 'enum', cases: \["Reader","Editor"\], enumValues: .*?defaultValue: "Reader",/,
    )
    Expect(code).toMatch(
      /\["OptionalRole"\]: \{ kind: 'enum', cases: \["Reader","Editor"\], enumValues: .*?optional: true, \}/,
    )
    Expect(code).toMatch(/\["Public"\]: \{ kind: "boolean", defaultValue: true,/)
    Expect(code).toMatch(/\["Pinned"\]: \{ kind: "boolean", defaultValue: false,/)
  })
})
