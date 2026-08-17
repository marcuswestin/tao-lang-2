import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: adaptive layout', () => {
  Test('preserves width max through the combined design spec IR', async () => {
    const compiled = await Compiler.compileCode(`
      use Col from @tao/ui

      app AdaptiveApp { view MainView }
      view MainView() {
        render Col() [width max 720]
      }
    `)

    Expect(compiled.code).toContain('TR.Design.Spec([["width","max",720]])')
  })
})
