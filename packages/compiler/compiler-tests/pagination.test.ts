import { Describe, Expect, stubView, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: query pagination', () => {
  Test('emits pageSize separately from limit and accepts values above 40', async () => {
    const compiled = await Compiler.compileCode(`
      data Documents / Document { Title text }
      app Demo { id "demo" version "1.0.0" name "Demo" view Home }
      view Home() {
        query Paginated = Documents with { paginate 41 }
        query Limited = Documents with { limit 7 }
        render Empty()
      }
      ${stubView('Empty')}
    `)

    Expect(compiled.code).toContain('pageSize: 41')
    Expect(compiled.code).toContain('limit: 7')
    Expect(compiled.code).not.toContain('limit: 41')
  })
})
