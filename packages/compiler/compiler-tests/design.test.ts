import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { TestCompiler } from './test-compile'

Describe('compiler: minimal design', () => {
  Test('gates only inline design explorations in release validation mode', async () => {
    const source = `
      use StackNav from @tao/nav
      app Demo { Name "Demo" Navigator StackNav { Initial Main } }
      view Main() { Title "Main" render Surface() [size 14, fg #fff] }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `

    const development = await TestCompiler.compileCode(source)
    Expect(development.validation.diagnostics.filter(diagnostic => diagnostic.code === 'design-check-exploration'))
      .toHaveLength(2)
    await Expect(TestCompiler.compileCode(source, { validationMode: 'release' })).rejects.toThrow(
      'must be promoted to a token, style bundle, or element default for release',
    )

    const ordinaryWarning = await TestCompiler.compileCode(
      `
      use SlotNav, StackNav from @tao/nav
      app Demo { Name "Demo" Navigator StackNav { Initial Main } }
      view Main() { Title "Main" render Surface() }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `,
      { validationMode: 'release' },
    )
    Expect(ordinaryWarning.validation.diagnostics.some(diagnostic => diagnostic.severity === 'warning')).toBe(true)
  })

  Test('marks linked standard elements for Capitalized design defaults', async () => {
    const compiled = await TestCompiler.compileCode(`
      use StackNav from @tao/nav
      use Text from @tao/ui
      app Demo { Name "Demo" Navigator StackNav { Initial Main } }
      view Main() { Title "Main" render Text("Hello") }
    `)

    Expect(compiled.code).toContain('designDefault: "Text"')
  })

  Test('emits declarative tokens, source-ordered specs, lazy app design, and occurrence specs', async () => {
    const compiled = await TestCompiler.compileCode(`
      use StackNav from @tao/nav

      workspace design Theme {
        paper #f6f7f3
        ink #121826
        screen [fill, content top stretch, pad 16, bg paper]
        title [size 28, weight 700, fg ink]
        compact [gap 8, gap 12]
      }

      app Demo {
        Name "Demo"
        Navigator StackNav { Initial Main }
        Design Theme
      }

      view Main() {
        Title "Main"
        render Surface() [screen, compact, gap 16, claim 2, width max 720, centered]
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
    Expect(code).toContain('"compact": TR.Design.Spec([["gap",8],["gap",12]])')
    Expect(code).toContain('design: () => _Scope.Theme.evaluate()')
    Expect(code).toContain(
      'designSpec: TR.Design.Spec([["screen"],["compact"],["gap",16],["claim",2],["width","max",720],["centered"]])',
    )
  })

  Test('imports and exports a visible design as an ordinary runtime value', async () => {
    await withTaoFiles('tao-design-compiler-', {
      'Main.tao': `
        use StackNav from @tao/nav
        use Theme from ./Theme
        app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
        view Main() { Title "Main" render Surface() [panel] }
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

  Test('compiles a mounted design override in an app refinement', async () => {
    await TestCompiler.compileCode(
      `
      use StackNav from @tao/nav
      design Light { canvas #fff screen [bg canvas] }
      design Dark { canvas #111 screen [bg canvas] }
      view Main() { Title "Main" render Surface() [screen] }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Light }
      app DemoDark = Demo with { Name "Demo Dark" Design Dark }
    `,
      { appName: 'DemoDark' },
    )
  })
})
