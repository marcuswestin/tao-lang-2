import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: phrases', () => {
  Test('compiles a single-form phrase, a parameterless phrase, and a plural phrase', async () => {
    const compiled = await Compiler.compileCode(`
      app PhrasesApp { view Main }
      phrase WeekTitle(Day text) = "Week of { Day }"
      phrase DocumentGone = "That document is gone."
      phrase ItemCount(Count number) = one "{ Count } item" / other "{ Count } items"
      view Main() {
        render Stack() {
          Text(WeekTitle("Monday"))
          Text(DocumentGone)
          Text(ItemCount(3))
        }
      }
      view Stack() { render inject Content @@content \`\`\`ts\nreturn Content\n\`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const code = compiled.files[0]?.code ?? ''

    // A single-form phrase compiles to a callable returning an interpolated string.
    Expect(code).toContain('_Scope.WeekTitle = TR.Function(')
    Expect(code).toContain('return TR.Interpolate([TR.Value("Week of "), _Scope.Day.evaluate()])')

    // A parameterless phrase compiles to a callable returning its plain text value directly.
    Expect(code).toContain('_Scope.DocumentGone = TR.Function(() => {')
    Expect(code).toContain('return TR.Value("That document is gone.")')
    // Its bare reference compiles to a zero-argument call of that callable.
    Expect(code).toContain('TR.Call(_Scope.DocumentGone)')

    // A plural phrase compiles to TR.Plural keyed by its declared categories.
    Expect(code).toContain('_Scope.ItemCount = TR.Function(')
    Expect(code).toContain('return TR.Plural(_Scope.Count.evaluate(), {')
    Expect(code).toContain('one: TR.Interpolate([_Scope.Count.evaluate(), TR.Value(" item")]),')
    Expect(code).toContain('other: TR.Interpolate([_Scope.Count.evaluate(), TR.Value(" items")]),')

    // A phrase call with an argument binds it the same way a function call does.
    Expect(code).toContain('TR.Call(_Scope.ItemCount, TR.Value(3))')
  })
})
