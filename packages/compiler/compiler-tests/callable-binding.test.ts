import { Describe, Expect, promptTagsApp, stubView, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: callable binding', () => {
  Test('emits globally resolved function arguments in parameter order', async () => {
    const compiled = await Compiler.compileCode(`
      type Root is text
      type Inner is Root
      type Leaf is Inner
      type Cousin is Root
      function Combine(Narrow Inner, Wide Root) { return "{ Narrow }/{ Wide }" }
      let Result = Combine(Cousin "cousin", Leaf "leaf")
      app Binding { id "binding" version "1.0.0" name "Binding" view Main }
      view Main() { render Empty() }
      ${stubView('Empty')}
    `)
    Expect(compiled.code).toContain('TR.Call(_Scope.Combine, TR.Value("leaf"), TR.Value("cousin"))')
  })

  Test('emits repeated roles in callee order and preserves action argument wrappers', async () => {
    const compiled = await Compiler.compileCode(`
      type Name is text
      function Pair(Left Name, Right Name) { return "{ Left }/{ Right }" }
      let Result = Pair(Right: Name "right", Left: Name "left")
      action Save(Left Name, Right Name) { }
      action Run() { do Save(Right: Name "right", Left: Name "left") }
      app Binding { id "binding" version "1.0.0" name "Binding" view Main }
      view Main() { render Empty() }
      ${stubView('Empty')}
    `)
    Expect(compiled.code).toContain('TR.Call(_Scope.Pair, TR.Value("left"), TR.Value("right"))')
    Expect(compiled.code.replace(/\s+/g, ' ')).toContain(
      'TR.Do(_Scope.Save.evaluate(), TR.Readonly(TR.Alias(() => TR.Value("left"))), TR.Readonly(TR.Alias(() => TR.Value("right"))))',
    )
  })
  Test('keeps nominal list field construction and forwarded callable parameters executable', async () => {
    const compiled = await Compiler.compileCode(promptTagsApp())
    Expect(compiled.code).toContain('["PromptTags"]: _Scope.StarterTags.evaluate().jsValue')
    Expect(compiled.code.match(/TR\.Call\(_Scope\.Join, _Scope\.Tags\.evaluate\(\), TR\.Value\(", "\)\)/g))
      .toHaveLength(2)
  })

  Test('emits directed repeated view roles by their owner names', async () => {
    const compiled = await Compiler.compileCode(`
      type Name is text
      app Binding { id "binding" version "1.0.0" name "Binding" view Main }
      view Main() { render Pair(Right: Name "right", Left: Name "left") }
      ${stubView('Pair', 'Left Name, Right Name')}
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('Left={TR.Readonly(TR.Alias(() => TR.Value("left")))}')
    Expect(code).toContain('Right={TR.Readonly(TR.Alias(() => TR.Value("right")))}')
  })
})
