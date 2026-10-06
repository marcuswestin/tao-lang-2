import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: render prefixes', () => {
  Test('lowers only attached occurrence metadata and preserves its tag', async () => {
    const compiled = await Compiler.compileCode(`
      use Col from @tao/ui
      app PrefixApp { id "prefixapp" version "1.0.0" name "Prefixes" view Main }
      view Main { render Col {
        #heading accessible label "Accessible heading" "Visible heading"
        "Sibling"
      } }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code.match(/accessibilityLabel:/g)?.length).toBe(1)
    Expect(code).toContain('testTag: "heading"')
    Expect(code).toContain('accessibilityLabel: TR.Value("Accessible heading").evaluate().jsValue')
    Expect(code).toContain('TR.Value("Visible heading")')
    Expect(code).toContain('TR.Value("Sibling")')
    Expect(code).not.toContain('accessible label')
  })

  Test('evaluates reactive labels inside render wiring and keeps ordinary expression boundaries', async () => {
    const compiled = await Compiler.compileCode(`
      use Col from @tao/ui
      app PrefixApp { id "prefixreactive" version "1.0.0" name "Prefixes" view Main }
      view Main { state Caption is text = "Library" render Col {
        accessible label (Caption) Leaf
        a11y label (Caption) "Quoted"
        accessible label "Literal" "Visible"
      } }
      view Leaf { render "Leaf" }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code.match(/accessibilityLabel: _Scope.Caption.evaluate\(\).evaluate\(\).jsValue/g)?.length).toBe(2)
    Expect(code.match(/accessibilityLabel:/g)?.length).toBe(3)
    Expect(code).toContain('<_Scope.Leaf')
    Expect(code).toContain('accessibilityLabel: TR.Value("Literal").evaluate().jsValue')
    Expect(code).toContain('_ViewProps.__tao, false)')
  })

  Test('normalizes prefix order and shorthand without changing emitted code', async () => {
    const header = 'use Col from @tao/ui app PrefixApp { id "prefixorder" version "1.0.0" name "Prefixes" view Main }'
    const canonical = await Compiler.compileCode(
      `${header} view Main { render Col { #heading accessible label "Label" "Visible" } }`,
    )
    const reversed = await Compiler.compileCode(
      `${header} view Main { render Col { a11y label "Label" #heading "Visible" } }`,
    )
    Expect(canonical.code).toBe(reversed.code)
  })
})
