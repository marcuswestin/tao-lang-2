import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { designValidationCodes } from '../validator-src/diagnostic-codes'
import Validator from '../validator-src/validator'
import { DesignValidator } from '../validator-src/validators/design-validator'
import { LayoutValidator } from '../validator-src/validators/layout-validator'
import { accepts, app, checksFiles, fence, rejects, tsFence, visibleView } from './test-validate'

const messages = DesignValidator.messages
const layoutMessages = LayoutValidator.messages

Describe('validator: minimal design', () => {
  Test('reports raw unnamed style values as stable warnings during ordinary validation', async () => {
    const result = await Validator.validateCode(`
      view Main() { render Surface() [gap 8, size 14, fg #fff] }
      ${surfaceView}
    `)
    const diagnostics = result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.exploration)

    Expect(diagnostics).toHaveLength(3)
    Expect(diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      messages.exploration('gap 8'),
      messages.exploration('size 14'),
      messages.exploration('fg #fff'),
    ])
    Expect(diagnostics.every(diagnostic => diagnostic.severity === 'warning')).toBe(true)
  })

  Test('does not warn for named style values or layout keywords', async () => {
    const result = await Validator.validateCode(designApp(
      'workspace design Theme { sizes { sm 8.px } ink #111 }',
      'render Surface() [gap sm, pad sm, fill, hug, claim 1, compress, centered, fg ink, weight bold]',
    ))

    Expect(result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.exploration))
      .toEqual([])
  })

  Test(
    // Card's body is view-rooted (`render Surface()`), not inject-rooted: the header must validate
    // the same way whichever kind of occurrence root the declaration ends up compiling.
    'validates a declaration header clause with the same design rules as a render-site clause',
    rejects(
      `
        use StackNav from @tao/nav
        workspace design Theme { paper #fff }
        app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
        scene Main() { Title "Main" render Card() }
        view Card() [bg missingToken] {
          render Surface()
        }
        ${surfaceView}
      `,
      messages.unknownToken('Theme', 'missingToken'),
    ),
  )

  Test(
    'accepts `none` as a clearing term on visual and layout value heads in a header clause',
    accepts(`
      app Demo { view Card }
      view Card() [bg none, border none, pad none, margin horizontal none, gap none, width none, height none, size none] {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `),
  )

  Test(
    'rejects `none` after a keyword head in a header clause',
    rejects(
      `
        app Demo { view Card }
        view Card() [fill none] {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      layoutMessages.clearsNoValue('fill none'),
    ),
  )

  Test(
    'rejects `none` followed by more terms in a header clause',
    rejects(
      `
        app Demo { view Card }
        view Card() [bg none paper] {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      messages.noneWithTrailingTerms('bg none paper'),
    ),
  )

  Test(
    'does not lint a raw zero or `none` as inline design exploration, but still lints a raw header hex',
    async () => {
      const result = await Validator.validateCode(`
      app Demo { view Card }
      view Card() [pad 0, bg none, bg #fff] {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

      const explorationMessages = result.diagnostics
        .filter(diagnostic => diagnostic.code === designValidationCodes.exploration)
        .map(diagnostic => diagnostic.message)
      Expect(explorationMessages).toEqual([messages.exploration('bg #fff')])
    },
  )

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

  Test('warns through a transparent project alias to the terminal stdlib Placeholder', async () => {
    const result = await Validator.validateCode(`
      use package @tao/ui as ui
      view Draft = ui.Placeholder
      view Main() { render Draft("Project content") }
    `)

    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.placeholderShipping
    )
    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.message).toBe(messages.placeholderShipping)
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
      messages.unknownSize('Theme', 'absent'),
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
    'accepts `when selected` as an interaction condition on an element default',
    accepts(designApp(
      `
      workspace design Theme {
        colors { inkMuted #666, accentSoft #eef, accentStrong #113 }
        styles {
          NavigationTab [pad 10, ink inkMuted, background accentSoft when selected, ink accentStrong when selected]
        }
      }
    `,
      'render Surface()',
    )),
  )

  Test('rejects an element default named in a render, header, or style clause list', async () => {
    const result = await Validator.validateCode(`
      use StackNav from @tao/nav
      workspace design Theme {
        colors { accentSoft #eef }
        styles {
          NavigationTab [pad 10]
          Hint [pad 4]
          tab [NavigationTab, background accentSoft]
        }
        NavigationTabActive [NavigationTab, background accentSoft]
      }
      app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
      scene Main() { Title "Main" render Card() [Hint] }
      view Card() [Hint, pad 2] {
        render Surface()
      }
      ${surfaceView}
    `)
    const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')

    // Each reference is one error with its own code: none also reads as an unknown bundle.
    Expect(errors.map(diagnostic => diagnostic.message).sort()).toEqual([
      messages.elementDefaultReference('Hint'),
      messages.elementDefaultReference('Hint'),
      messages.elementDefaultReference('NavigationTab'),
      messages.elementDefaultReference('NavigationTab'),
    ])
    Expect(errors.every(diagnostic => diagnostic.code === designValidationCodes.elementDefaultReference)).toBe(true)
  })

  Test(
    'rejects an element default named in a clause list even with no app design selected',
    async () => {
      const result = await Validator.validateCode(`
        app Legacy { view Main }
        view Main() { render Surface() [Hint] }
        ${surfaceView}
      `)

      const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')

      // Only the rule itself fires: no unknown layout entry and no missing design for a name nothing may reach.
      Expect(errors.map(diagnostic => diagnostic.message)).toEqual([messages.elementDefaultReference('Hint')])
    },
  )

  Test('rejects Capitalized colors, sizes, text styles, screens, and flat color tokens', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        Brand #fff
        colors { Accent #f60, ink #111 }
        sizes { Gutter 8.px, sm 4.px }
        text { Title [size 20] body [size 16] }
        screens { Narrow below 500.px, wide }
        styles { Text [ink ink] card [pad sm] }
        Surface [background Accent]
      }
    `)
    const errors = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.capitalizedDesignName
    )

    // Capitalized styles and flat bundles are element defaults, so `Text` and `Surface` stay legal.
    Expect(errors.map(diagnostic => diagnostic.message)).toEqual([
      messages.capitalizedDesignName('Brand'),
      messages.capitalizedDesignName('Accent'),
      messages.capitalizedDesignName('Gutter'),
      messages.capitalizedDesignName('Title'),
      messages.capitalizedDesignName('Narrow'),
    ])
    Expect(errors.every(diagnostic => diagnostic.severity === 'error')).toBe(true)
  })

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

  Test('warns for the legacy bg/fg spelling at a render site, anchored on the head', async () => {
    const result = await Validator.validateCode(designApp(
      'workspace design Theme { canvas #fff }',
      'render Surface() [bg canvas]',
    ))
    const warnings = result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.legacyVisualHead)

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.message).toBe(messages.legacyVisualHead('bg', 'background'))
    Expect(warnings[0]?.severity).toBe('warning')
  })

  Test('warns for the legacy bg/fg spelling in a declaration header clause, including a clearing entry', async () => {
    const result = await Validator.validateCode(`
      app Demo { view Card }
      view Card() [bg none] {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const warnings = result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.legacyVisualHead)

    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.message).toBe(messages.legacyVisualHead('bg', 'background'))
  })

  Test('warns for the legacy bg/fg spelling in a flat design bundle and a styles block entry', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        canvas #fff
        card [bg canvas]
        styles {
          panel [fg canvas]
        }
      }
    `)
    const warnings = result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.legacyVisualHead)

    Expect(warnings.map(diagnostic => diagnostic.message)).toEqual([
      messages.legacyVisualHead('bg', 'background'),
      messages.legacyVisualHead('fg', 'ink'),
    ])
  })

  Test('does not warn about a legacy visual head for the decided background and ink spellings', async () => {
    const result = await Validator.validateCode(designApp(
      'workspace design Theme { canvas #fff card [background canvas] }',
      'render Surface() [card, background canvas]',
    ))

    Expect(result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.legacyVisualHead))
      .toEqual([])
  })

  Test('warns once, on the declaration, for a design with several flat catalog entries', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        canvas #fff
        ink #111
        card [background canvas]
        panel [ink ink]
      }
    `)
    const warnings = result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.flatCatalog)

    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.message).toBe(messages.flatCatalog('Theme', 4))
    Expect(warnings[0]?.severity).toBe('warning')
  })

  Test('does not warn about a flat catalog when every member lives in a typed block', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        colors { canvas #fff }
        styles { card [background canvas] }
      }
    `)

    Expect(result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.flatCatalog))
      .toEqual([])
  })

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

  Test('uses one private member namespace while allowing the represented line token', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        line #ddd
        panel #fff
        panel [bg line]
        fill [pad 8]
      }
    `)

    const duplicateMember = result.diagnostics.find(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateMember
    )
    const reservedBundle = result.diagnostics.find(diagnostic =>
      diagnostic.code === designValidationCodes.reservedBundle
    )
    // A token may carry a visual head's name: `line` is only reserved where a bundle would shadow the
    // built-in clause. `panel` declared twice and a `fill` bundle are both unreachable, so both fail.
    Expect(duplicateMember?.message).toBe(messages.duplicateMember('panel'))
    Expect(duplicateMember?.severity).toBe('error')
    Expect(reservedBundle?.message).toBe(messages.reservedBundle('fill'))
    Expect(reservedBundle?.severity).toBe('error')
    Expect(
      result.diagnostics.filter(diagnostic =>
        diagnostic.severity === 'error'
        && diagnostic.code !== designValidationCodes.duplicateMember
        && diagnostic.code !== designValidationCodes.reservedBundle
      ),
    ).toEqual([])
  })

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
      scene Main() { Title "Main" render Surface() [panel] }
      ${surfaceView}
    `),
  )

  Test(
    'requires a shared style and layout size in every directly mounted design',
    rejects(
      `
      workspace design Light { sizes { sm 8.px } styles { panel [pad sm] } }
      workspace design Dark { styles { other [pad 8] } }
      app LightApp { view Main Design Light }
      app DarkApp { view Main Design Dark }
      view Main() { render Surface() [panel, gap sm] }
      ${surfaceView}
    `,
      messages.unknownBundle('Dark', 'panel'),
      messages.unknownSize('Dark', 'sm'),
    ),
  )

  Test(
    'requires a shared style in a design mounted by an app refinement',
    rejects(
      `
      workspace design Light { styles { panel [pad 8] } }
      workspace design Dark { styles { other [pad 8] } }
      app Demo { view Main Design Light }
      app DemoDark = Demo with { Design Dark }
      view Main() { render Surface() [panel] }
      ${surfaceView}
    `,
      messages.unknownBundle('Dark', 'panel'),
    ),
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

  Test('warns when a view style definition has a property already present in an applied style', async () => {
    const result = await Validator.validateCode(
      designApp(
        `workspace design Theme {
          accent #f60
          header [hug, pad 14, bg accent]
        }`,
        'render Surface() [header, hug]',
      ),
    )
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.message).toBe(messages.duplicateStyleProperty('hug', 'header'))
    Expect(warnings[0]?.severity).toBe('warning')
  })

  Test('warns when an applied style property is overridden inline by a spacing or visual entry', async () => {
    const result = await Validator.validateCode(
      designApp(
        `workspace design Theme {
          accent #f60
          snow #fff
          header [hug, pad 14, bg accent]
        }`,
        'render Surface() [header, pad 10, bg snow]',
      ),
    )
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(2)
    Expect(warnings[0]?.message).toBe(messages.duplicateStyleProperty('pad', 'header'))
    Expect(warnings[1]?.message).toBe(messages.duplicateStyleProperty('bg', 'header'))
  })

  Test('names a repeated visual property as written, and by its decided spelling when the two differ', async () => {
    const result = await Validator.validateCode(
      designApp(
        `workspace design Theme {
          colors { ink #111, paper #fff, accent #f60 }
          styles {
            card [ink ink]
            header [bg accent]
          }
        }`,
        'render Surface() [card, ink paper] render Surface() [header, background paper]',
      ),
    )
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    // The runtime keys both slots as `fg` and `bg`; neither spelling appears in this source.
    Expect(warnings.map(diagnostic => diagnostic.message)).toEqual([
      messages.duplicateStyleProperty('ink', 'card'),
      messages.duplicateStyleProperty('background', 'header'),
    ])
  })

  Test('warns when multiple applied styles share a property', async () => {
    const result = await Validator.validateCode(
      designApp(
        `workspace design Theme {
          styleA [hug, pad 14]
          styleB [pad 10, radius 8]
        }`,
        'render Surface() [styleA, styleB]',
      ),
    )
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.message).toBe(messages.duplicateStyleProperty('pad', 'styleA'))
  })

  Test('warns through transitively inherited bundle properties', async () => {
    const result = await Validator.validateCode(
      designApp(
        `workspace design Theme {
          base [pad 14]
          header [base, hug]
        }`,
        'render Surface() [header, pad 10]',
      ),
    )
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.message).toBe(messages.duplicateStyleProperty('pad', 'header'))
  })

  Test('does not warn when applied style and inline entry have disjoint properties', async () => {
    const result = await Validator.validateCode(
      designApp(
        `workspace design Theme {
          card #fff
          line #ddd
          storyCard [pad 12, radius 10, bg card, border line]
        }`,
        'render Surface() [storyCard, gap 10]',
      ),
    )
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(0)
  })

  Test('does not warn when an inline visual entry is an interaction state condition', async () => {
    const result = await Validator.validateCode(
      designApp(
        `workspace design Theme {
          accent #f60
          snow #fff
          header [bg accent]
        }`,
        'render Surface() [header, bg snow when pressed]',
      ),
    )
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(0)
  })

  Test('rejects a design block that re-declares a design name twice', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        header [hug, pad 14]
        header [pad 16]
      }
    `)
    const errors = result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.duplicateMember)

    // The compiled design is one keyed map, so the second `header` replaces the first outright.
    Expect(errors).toHaveLength(1)
    Expect(errors[0]?.message).toBe(messages.duplicateMember('header'))
    Expect(errors[0]?.severity).toBe('error')
  })

  Test('rejects a design member that collides with a built-in clause the runtime answers first', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        hug [pad 14]
        styles {
          fill [pad 8]
        }
      }
    `)
    const errors = result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.reservedBundle)

    // TR-design.ts answers `hug` and `fill` as built-in heads before it looks a bundle up, so neither
    // member could ever resolve. A style entry compiles into the same bundle map and fails the same way.
    Expect(errors.map(diagnostic => diagnostic.message)).toEqual([
      messages.reservedBundle('hug'),
      messages.reservedBundle('fill'),
    ])
    Expect(errors.every(diagnostic => diagnostic.severity === 'error')).toBe(true)
  })

  Test('warns when a design property has redundant style properties', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        accent #f60
        header [hug, pad 14, bg accent, hug]
      }
    `)
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.message).toBe(messages.precedingStyleProperty('hug', 'hug'))
    Expect(warnings[0]?.severity).toBe('warning')
  })

  Test('accepts entries that share a head but claim independent slots', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        sides [pad top 4, pad left 8, margin top 2, margin bottom 2]
        axes [content top, content left]
        span [width fill, width max 680]
        edges [aligned top, aligned left]
      }
    `)

    // `pad top` and `pad left` are different sides, `content top` and `content left` different axes,
    // and `width max` the independent maximum: LayoutValidator allows every pair, so none is redundant.
    Expect(
      result.diagnostics.filter(diagnostic => diagnostic.code === designValidationCodes.duplicateStyleProperty),
    ).toEqual([])
    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  })

  Test('reports the slot a repeated side or axis actually re-claims', async () => {
    const result = await Validator.validateCode(`
      workspace design Theme {
        sides [pad top 4, pad vertical 8]
        axes [content top, content bottom]
        span [width 200, width fill]
      }
    `)
    const warnings = result.diagnostics.filter(diagnostic =>
      diagnostic.code === designValidationCodes.duplicateStyleProperty
    )

    // `pad vertical` covers `top`, `content bottom` is the same vertical axis, and a second plain
    // `width` is the same slot. Each entry is reported once even when it re-claims several slots.
    Expect(warnings.map(diagnostic => diagnostic.message)).toEqual([
      messages.precedingStyleProperty('pad', 'pad top 4'),
      messages.precedingStyleProperty('content', 'content top'),
      messages.precedingStyleProperty('width', 'width 200'),
    ])
  })

  Test(
    'keeps same-named private designs in separate files apart',
    checksFiles({
      'Main.tao': `
        use FirstSurface from ./first/First
        use SecondSurface from ./second/Second
        ${app('render FirstSurface() render SecondSurface()')}
      `,
      'first/First.tao': `
        design Theme {
          base [pad 14]
          header [base, pad 10]
        }
        ${visibleView('FirstSurface')}
      `,
      'second/Second.tao': `
        design Theme {
          base [gap 4]
          header [base, pad 10]
        }
        ${visibleView('SecondSurface')}
      `,
    }, result => {
      const warnings = result.diagnostics.filter(diagnostic =>
        diagnostic.code === designValidationCodes.duplicateStyleProperty
      )

      // Both files declare their own file-private `Theme`, and one validation run walks both. Only the
      // first one's `header` repeats `pad`; keying the bundle-property memo by design name alone hands
      // the second file the first design's map and reports a redundancy that is not in its source.
      Expect(warnings.map(diagnostic => `${FS.basename(diagnostic.filePath ?? '')}: ${diagnostic.message}`)).toEqual([
        `First.tao: ${messages.duplicateStyleProperty('pad', 'base')}`,
      ])
    }),
  )
})

function designApp(design: string, body: string): string {
  return `
    use StackNav from @tao/nav
    ${design}
    app Demo { Name "Demo" Navigator StackNav { Initial Main } Design Theme }
    scene Main() { Title "Main" ${body} }
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
