import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: public none entity guards', () => {
  Test('emits the entity read hint for an optional entity union', async () => {
    const compiled = await Compiler.compileCode(`
      app OptionalAuthorApp { id "com.tao.test.optionalauthor" version "1.0.0" name "OptionalAuthorApp" view Home }
      data Authors / Author { Name text }
      view Home() { render Main(none) }
      view Main(Person Author?) {
        render Stack() {
          guard Person { none -> { Text("Unknown author") } }
        }
      }
      view Stack() { render inject Content @@content \`\`\`ts
        return Content
      \`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts
        return null
      \`\`\` }
    `)

    const code = compiled.files[0]?.code ?? ''
    Expect(code).toContain('TR.GuardRender(_Scope.Person.evaluate(), [')
    Expect(code).toContain('{"readKind":"entity","subjectType":"Author"}')
  })
})
