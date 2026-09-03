import { Describe, Expect, Test } from '@shared/test'
import { designValidationCodes } from '../validator-src/diagnostic-codes'
import Validator from '../validator-src/validator'
import { DesignValidator } from '../validator-src/validators/design-validator'
import { accepts, fence, rejects, tsFence } from './test-validate'

const messages = DesignValidator.messages

Describe('validator: minimal design', () => {
  Test('reports inline design explorations as stable warnings during ordinary validation', async () => {
    const result = await Validator.validateCode(`
      view Main() { render Surface() [gap 8, size 14, fg #fff] }
      ${surfaceView}
    `)
    const diagnostics = result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.exploration)

    Expect(diagnostics).toHaveLength(3)
    Expect(diagnostics.every(diagnostic => diagnostic.severity === 'warning')).toBe(true)
  })

  Test('warns when the stdlib Placeholder ships while accepting Placeholder and Spacer', async () => {
    const result = await Validator.validateCode(`
      use Col, Placeholder, Spacer from @tao/ui
      view Main() {
        render Col() {
          Placeholder("Saved status icon") [width 20, height 20]
          Spacer() [claim 3]
        }
      }
    `)
    const diagnostics = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.placeholderShipping
    )

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(diagnostics).toHaveLength(1)
    Expect(diagnostics[0]?.message).toBe(messages.placeholderShipping)
    Expect(diagnostics[0]?.severity).toBe('warning')
  })

  Test('does not warn for a project view that happens to be named Placeholder', async () => {
    const result = await Validator.validateCode(`
      view Placeholder(Label text) {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view Main() { render Placeholder("Project content") }
    `)

    Expect(result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.placeholderShipping))
      .toEqual([])
  })

  Test(
    'accepts exact hex forms, WordFlower bundles, and decomposed later layout effects',
    accepts(designApp(
      `
      workspace design Theme {
        short #abc
        alpha #abcd
        paper #f6f7f3
        overlayColor #121826cc
        line #d9dcd4
        screen [fill, content top stretch, pad 16, bg paper]
        constrained [screen, claim 2, width max 720, centered]
        panel [pad 12, radius 8, bg paper, border line]
      }
    `,
      'render Surface() [constrained, panel]',
    )),
  )

  Test(
    'accepts decided background and ink names alongside current visual and spacing families',
    accepts(designApp(
      `
      workspace design Theme {
        canvas #fff
        ink #111
        lineColor #ddd
        card [background canvas, ink ink, border lineColor, radius 12, pad 16, gap 8]
        body [size 16, weight 600, line 22]
      }
    `,
      'render Surface() [card, body]',
    )),
  )

  Test(
    'accepts decided background and ink names directly on a rendered element',
    accepts(designApp(
      'workspace design Theme { canvas #fff ink #111 }',
      'render Surface() [background canvas, ink ink]',
    )),
  )

  Test(
    'accepts exact Light and Dark Scheme conditions on visual entries',
    accepts(designApp(
      `
      workspace design Theme {
        canvas #fff
        canvasDark #111
        Surface [background canvas, background canvasDark when Scheme is Dark]
      }
    `,
      'render Surface()',
    )),
  )

  Test(
    'accepts structured typed blocks, color families, folded sizes, screens, styles, and defaults',
    accepts(designApp(
      `
      workspace design Theme {
        colors {
          cream #fff
          ember #d9622b { 20 #f4d7c8, 60 #b34e1f }
          canvas when Scheme is Dark ember.60 / not cream
        }
        sizes { sm 8.px, md sm + 4.px, readable 1.rem }
        text { title [size readable, weight semibold, line md] }
        screens { narrow below 500.px, medium below 1000.px, wide }
        styles {
          card [background canvas, radius md, pad md, gap sm]
          Text [ink canvas]
        }
      }
    `,
      'render Surface() [card, title]',
    )),
  )

  Test(
    'resolves named design sizes in direct layout clauses',
    accepts(designApp(
      'workspace design Theme { sizes { sm 8.px, readable 1.rem } }',
      'render Surface() [gap sm, pad sm, margin sm, width readable, height readable]',
    )),
  )

  Test(
    'rejects missing or unknown named layout sizes',
    rejects(
      `
        app Legacy { view Main }
        view Main() { render Surface() [gap sm] }
        ${surfaceView}
      `,
      messages.missingMountedDesign('gap sm'),
    ),
  )

  Test(
    'rejects a named layout size absent from the selected design',
    rejects(
      designApp('workspace design Theme { sizes { sm 8.px } }', 'render Surface() [width absent]'),
      "Design 'Theme' has no size 'absent'.",
    ),
  )

  Test(
    'rejects invalid structured conditions, units, and screen ordering',
    rejects(
      designApp(
        `workspace design Theme {
          colors { ink when Motion is Dark #fff / not #111 }
          sizes { bad 2.seconds }
          screens { wide, narrow below 400.px }
          styles { card [ink ink] }
        }`,
        'render Surface() [card]',
      ),
      messages.invalidColorCondition,
      messages.invalidSize('bad'),
      messages.invalidScreen('wide'),
    ),
  )

  Test(
    'rejects malformed or unrelated visual conditions',
    rejects(
      designApp(
        'workspace design Theme { canvas #fff Surface [background canvas when Viewport is Dark] }',
        'render Surface()',
      ),
      messages.malformedVisual('background canvas when Viewport is Dark'),
    ),
  )

  Test(
    'rejects mixed source aliases that normalize to the same visual property',
    rejects(
      designApp(
        'workspace design Theme { canvas #fff paper #eee card [bg canvas, background paper] }',
        'render Surface() [card]',
      ),
      messages.duplicateVisualAlias('bg', 'background'),
    ),
  )

  for (const color of ['#12', '#12345', '#1234567', '#xyz']) {
    Test(
      `rejects malformed contextual color ${color}`,
      rejects(
        `workspace design Theme { ink ${color} }`,
        messages.malformedColor(color),
      ),
    )
  }

  Test(
    'rejects digit-leading contextual tokens in every tag context',
    rejects(
      `
        test "tags" {
          test "digit leading" {
            press #123abc
          }
        }
      `,
      messages.malformedTag('#123abc'),
    ),
  )

  Test(
    'uses one private member namespace while allowing the represented line token',
    rejects(
      `
        workspace design Theme {
          line #ddd
          panel #fff
          panel [bg line]
          fill [pad 8]
        }
      `,
      messages.duplicateMember('panel'),
      messages.reservedBundle('fill'),
    ),
  )

  Test(
    'rejects malformed visual entries, unknown tokens and bundles, and cycles',
    rejects(
      `
        workspace design Theme {
          ink #111
          badWeight [weight 750]
          badColor [bg absent]
          first [second]
          second [first]
          unknown [notThere]
        }
      `,
      messages.malformedVisual('weight 750'),
      messages.unknownToken('Theme', 'absent'),
      messages.unknownBundle('Theme', 'notThere'),
      messages.bundleCycle('Theme', ['first', 'second', 'first']),
    ),
  )

  Test(
    'resolves render bundle and token names exactly with one selected workspace design',
    rejects(
      designApp(
        'workspace design Theme { ink #111 body [fg ink] }',
        'render Surface() [unknownBundle, fg absent]',
      ),
      messages.unknownBundle('Theme', 'unknownBundle'),
      messages.unknownToken('Theme', 'absent'),
    ),
  )

  Test(
    'requires an app design for a design-dependent render spec',
    rejects(
      `
        app Legacy { view Main }
        view Main() { render Surface() [panel] }
        ${surfaceView}
      `,
      messages.missingMountedDesign('panel'),
    ),
  )

  Test(
    'accepts self-contained numeric visuals with no app design selected',
    accepts(`
      app Legacy { view Main }
      view Main() { render Surface() [size 14, radius 8, weight 600, line 20] }
      ${surfaceView}
    `),
  )

  Test(
    'still requires an app design for a color token with no design selected',
    rejects(
      `
        app Legacy { view Main }
        view Main() { render Surface() [size 14, fg ink] }
        ${surfaceView}
      `,
      messages.missingMountedDesign('fg ink'),
    ),
  )

  Test(
    'defers private bundle lookup when different mounted apps select different designs',
    accepts(`
      use StackNav from @tao/nav
      workspace design Light { surface #fff panel [bg surface] }
      workspace design Dark { surface #000 panel [bg surface] }
      app LightApp { Name "Light" Navigator StackNav { Initial Main } Design Light }
      app DarkApp { Name "Dark" Navigator StackNav { Initial Main } Design Dark }
      view Main() { Title "Main" render Surface() [panel] }
      ${surfaceView}
    `),
  )

  Test(
    'rejects incompatible claim and rigid effects that both remain effective',
    rejects(
      designApp(
        'workspace design Theme { weighted [claim 2, rigid] }',
        'render Surface() [weighted]',
      ),
      messages.weightedRigidClaim,
    ),
  )

  Test(
    'applies replacement across expanded bundles before checking surviving incompatibilities',
    accepts(designApp(
      `
      workspace design Theme {
        weighted [claim 2]
        stiff [rigid]
        flexible [compress]
      }
    `,
      'render Surface() [weighted, stiff, flexible]',
    )),
  )

  Test(
    'lets an intervening bundle replace a direct winner before incompatibility validation',
    accepts(designApp(
      'workspace design Theme { resetGrowth [fill] }',
      'render Surface() [claim 2, resetGrowth, rigid]',
    )),
  )

  Test(
    'rejects incompatible effects that survive across separate bundles',
    rejects(
      designApp(
        `
        workspace design Theme {
          weighted [claim 2]
          stiff [rigid]
        }
      `,
        'render Surface() [stiff, weighted]',
      ),
      messages.weightedRigidClaim,
    ),
  )
})

function designApp(design: string, body: string): string {
  return `
    use StackNav from @tao/nav
    ${design}
    app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
    view Main() { Title "Main" ${body} }
    ${surfaceView}
  `
}

const surfaceView = `
  view Surface() {
    render inject ${tsFence}
      return null
    ${fence}
  }
`
