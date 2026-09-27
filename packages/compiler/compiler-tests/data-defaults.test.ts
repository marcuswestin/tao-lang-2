import { Describe, Expect, stubView, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: data defaults', () => {
  Test('keeps optional inverse syntax as computed collection metadata and a relation query', async () => {
    const compiled = await Compiler.compileCode(`
      data Owners / Owner { Children? }
      data Children / Child { Owner }
      app Collections { view Main }
      view Main() { render Empty() }
      view Inspect(Owner) {
        let Count = Owner.Children.Count
        query Children = Owner.Children with { }
        render Empty()
      }
      ${stubView('Empty')}
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toMatch(/inverseFields: \{ \["Children"\]: \{ relation: "Child", inverseField: "Owner", \}, \}/)
    Expect(code).toContain('entity: "Child", filters: [ { field: "Owner", operator: \'==\',')
    Expect(code).toContain('["Children", "Count"]')
  })

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
      /\["Role"\]: \{ kind: "enum", cases: \["Reader","Editor"\], enumValues: .*?defaultValue: "Reader",/,
    )
    Expect(code).toMatch(
      /\["OptionalRole"\]: \{ kind: "enum", cases: \["Reader","Editor"\], optional: true, enumValues: \(\) => _Scope\.Role, \}/,
    )
    Expect(code).toMatch(/\["Public"\]: \{ kind: "boolean", defaultValue: true,/)
    Expect(code).toMatch(/\["Pinned"\]: \{ kind: "boolean", defaultValue: false,/)
  })
})
