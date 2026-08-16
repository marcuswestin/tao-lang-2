import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { TestCompiler } from './test-compile'

Describe('compiler: minimal design', () => {
  Test('emits declarative tokens, source-ordered specs, lazy app design, and occurrence specs', async () => {
    const compiled = await TestCompiler.compileCode(`
      use StackNav from @tao/nav

      workspace design Theme {
        paper #f6f7f3
        ink #121826
        screen [fill, content top stretch, pad 16, bg paper]
        title [size 28, weight 700, fg ink]
      }

      app Demo {
        Name "Demo"
        Navigator StackNav { Initial Main }
        Design Theme
      }

      ui Main() {
        render Surface() [screen, claim 2, width max 720, centered]
      }

      view Surface() {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('_Scope.Theme = TR.Design.Declaration({')
    Expect(code).toContain('"paper": "#f6f7f3"')
    Expect(code).toContain('"screen": TR.Design.Spec([["fill"],["content","top","stretch"],["pad",16],["bg","paper"]])')
    Expect(code).toContain('design: () => _Scope.Theme.evaluate()')
    Expect(code).toContain('designSpec: TR.Design.Spec([["screen"],["claim",2],["width","max",720],["centered"]])')
  })

  Test('imports and exports a visible design as an ordinary runtime value', async () => {
    await withTaoFiles('tao-design-compiler-', {
      'Main.tao': `
        use StackNav from @tao/nav
        use Theme from ./Theme
        app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
        ui Main() { render Surface() [panel] }
        view Surface() { render inject \`\`\`ts return null \`\`\` }
      `,
      'Theme.tao': `
        public design Theme { paper #fff panel [bg paper] }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'])
      const main = compiled.files.find(file => file.sourcePath === paths['Main.tao'])
      const theme = compiled.files.find(file => file.sourcePath === paths['Theme.tao'])

      Expect(main?.code).toContain("import { Theme } from './modules/Theme.tao'")
      Expect(main?.code).toContain("TR.Use(_Scope, 'Theme', () => Theme)")
      Expect(theme?.code).toContain('_Scope.Theme = TR.Design.Declaration({')
      Expect(theme?.code).toContain('export const Theme = _Scope.Theme')
    })
  })
})
