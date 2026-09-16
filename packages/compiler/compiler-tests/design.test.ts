import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { TestCompiler } from './test-compile'

Describe('compiler: minimal design', () => {
  Test('gates only inline design explorations in release validation mode', async () => {
    const source = `
      use StackNav from @tao/nav
      app Demo { Name "Demo" Navigator StackNav { Initial Main } }
      scene Main() { Title "Main" render Surface() [size 14, fg #fff] }
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
      scene Main() { Title "Main" render Surface() }
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
      scene Main() { Title "Main" render Text("Hello") }
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

      scene Main() {
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

  Test('lowers decided background and ink terms through the compatible runtime ABI', async () => {
    const compiled = await TestCompiler.compileCode(`
      use StackNav from @tao/nav
      workspace design Theme {
        canvas #fff
        ink #111
        card [background canvas, ink ink, border ink, radius 12, pad 16, gap 8]
        body [size 16, weight 600, line 22]
      }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
      scene Main() { Title "Main" render Surface() [card, body] }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain(
      '"card": TR.Design.Spec([["bg","canvas"],["fg","ink"],["border","ink"],["radius",12],["pad",16],["gap",8]])',
    )
    Expect(code).toContain('"body": TR.Design.Spec([["size",16],["weight",600],["line",22]])')
  })

  Test('preserves exact Scheme conditions while lowering their visual source heads', async () => {
    const compiled = await TestCompiler.compileCode(`
      use StackNav from @tao/nav
      workspace design Theme {
        canvas #fff
        canvasDark #111
        Surface [background canvas, background canvasDark when Scheme is Dark]
      }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
      scene Main() { Title "Main" render Surface() }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `)

    Expect(compiled.code.replace(/\s+/g, ' ')).toContain(
      '"Surface": TR.Design.Spec([["bg","canvas"],["bg","canvasDark","when","Scheme","is","Dark"]])',
    )
  })

  Test('lowers structured typed design blocks, families, sizes, screens, and source provenance', async () => {
    const compiled = await TestCompiler.compileCode(
      `
      use StackNav from @tao/nav
      workspace design Theme {
        colors {
          cream #fff
          ember #d9622b { 20 #f4d7c8 }
          canvas when Scheme is Dark ember / not cream
        }
        sizes { sm 8.px, md sm + 4.px, readable 1.rem }
        text { title [size readable, weight semibold, line md] }
        screens { narrow below 500.px, wide }
        styles {
          card [background canvas, radius md, pad md, gap sm]
          Text [ink canvas]
        }
      }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
      scene Main() { Title "Main" render Surface() [card, title] }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `,
      { studio: true },
    )

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('"ember.20": "#f4d7c8"')
    Expect(code).toContain('environment: "Scheme"')
    Expect(code).toContain('"md": { left: { kind: "reference", path: "sm" }, right:')
    Expect(code).toContain('screens: [ { name: "narrow", below: 500')
    Expect(code).toContain('kind: "style"')
    Expect(code).toContain('member: "card"')
    Expect(code).toContain('kind: "inline"')
  })

  Test('does not rewrite a bare design member name as a visual alias', async () => {
    const compiled = await TestCompiler.compileCode(`
      use StackNav from @tao/nav
      workspace design Theme { ink #111 }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
      scene Main() { Title "Main" render Surface() }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `)

    Expect(compiled.code).toContain('"ink": "#111"')
  })

  Test('release design checks accept promoted representable families and reject their inline raw values', async () => {
    const inline = `
      use StackNav from @tao/nav
      app Demo { Name "Demo" Navigator StackNav { Initial Main } }
      scene Main() { Title "Main" render Surface() [background #fff, size 16, radius 8, pad 12] }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `
    await Expect(TestCompiler.compileCode(inline, { validationMode: 'release' })).rejects.toThrow(
      'must be promoted to a token, style bundle, or element default for release',
    )

    await TestCompiler.compileCode(
      `
      use StackNav from @tao/nav
      workspace design Theme { paper #fff Surface [background paper, size 16, radius 8, pad 12] }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
      scene Main() { Title "Main" render Surface() }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `,
      { validationMode: 'release' },
    )

    await TestCompiler.compileCode(
      `
      use StackNav from @tao/nav
      workspace design Theme {
        colors { paper #fff }
        sizes { surfaceSize 16.px, surfaceRadius 8.px, surfacePad 12.px }
        styles { Surface [background paper, size surfaceSize, radius surfaceRadius, pad surfacePad] }
      }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
      scene Main() { Title "Main" render Surface() }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `,
      { validationMode: 'release' },
    )

    await TestCompiler.compileCode(
      `
      use StackNav from @tao/nav
      workspace design Theme { sizes { sm 8.px } }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
      scene Main() { Title "Main" render Surface() [gap sm, fill] }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
    `,
      { validationMode: 'release' },
    )
  })

  Test('imports and exports a visible design as an ordinary runtime value', async () => {
    await withTaoFiles('tao-design-compiler-', {
      'Main.tao': `
        use StackNav from @tao/nav
        use Theme from ./Theme
        app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
        scene Main() { Title "Main" render Surface() [panel] }
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
      scene Main() { Title "Main" render Surface() [screen] }
      view Surface() { render inject \`\`\`ts return null \`\`\` }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Light }
      app DemoDark = Demo with { Name "Demo Dark" Design Dark }
    `,
      { appName: 'DemoDark' },
    )
  })
})
