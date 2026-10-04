import { Describe, Expect, Test } from '@shared/test'
import { designValidationCodes } from '../validator-src/diagnostic-codes'
import Validator from '../validator-src/validator'
import { colorValueValidationMessages } from '../validator-src/validators/color-values-validator'
import { DesignValidator } from '../validator-src/validators/design-validator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { accepts, fence, rejects, tsFence, validationErrorMessages } from './test-validate'

const designMessages = DesignValidator.messages
const colorMessages = colorValueValidationMessages
const invocationMessages = InvocationsValidator.messages

Describe('validator: color values', () => {
  Test(
    'accepts design color names as defaults and arguments, including shades, derived colors, and color values',
    accepts(colorApp(`
      view UsesDefault() { render Badge("Draft") }
      view UsesAccent() { render Badge("Final", Tint: accent) }
      view UsesShade() { render Badge("Soft", Tint: accent.20) }
      view UsesDerived() { render Badge("Ink", Tint: schemeInk) }
      view UsesRequired() { render Dot(accent) }
      view Forwards(Shade color default inkMuted) { render Badge("Forwarded", Tint: Shade) }
    `)),
  )

  Test(
    'accepts a value read in a render clause, a conditioned clause, and a declaration header clause',
    accepts(colorApp(`
      view Pressable(Tint color default accent) [background Tint] {
        render Surface() [ink Tint, border Tint when pressed]
      }
    `)),
  )

  Test('accepts design color names wherever several designs mount the view', async () => {
    const result = await Validator.validateCode(`
      use StackNav from @tao/nav
      ${themeDesign('Light')}
      ${themeDesign('Dark')}
      app Demo { id "demo" version "1.0.0" name "Demo" Navigator StackNav { Initial Main } Design Light }
      app DemoDark = Demo with { id "demodark" name "Demo Dark" Design Dark }
      scene Main() { Title "Main" render Badge("Final", Tint: accent) }
      ${colorViews}
    `)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('links a color only one mounted design declares and names each design that lacks it', async () => {
    const result = await Validator.validateCode(`
      use StackNav from @tao/nav
      ${themeDesign('Light')}
      ${themeDesign('Dark', 'glow #ffcc00')}
      app Demo { id "demo" version "1.0.0" name "Demo" Navigator StackNav { Initial Main } Design Light }
      app DemoDark = Demo with { id "demodark" name "Demo Dark" Design Dark }
      scene Main() { Title "Main" render Badge("Final", Tint: glow) }
      view Glowing(Tint color default glow) { render Surface() [background Tint] }
      ${colorViews}
    `)

    // The name resolves through the refined app's design, so neither use reads as unknown; each is
    // then an error because `Light`, which the base app mounts, lacks it.
    Expect(validationErrorMessages(result)).toEqual([
      colorMessages.missingDesignColor('Light', 'glow', 'Main'),
      colorMessages.missingDesignColor('Light', 'glow', 'Glowing'),
    ])
  })

  Test('accepts a color that only a design mounted through a refinement declares', async () => {
    const result = await Validator.validateCode(`
      use StackNav from @tao/nav
      ${themeDesign('Dark', 'glow #ffcc00')}
      app Demo { id "demo" version "1.0.0" name "Demo" Navigator StackNav { Initial Main } }
      app DemoDark = Demo with { id "demodark" name "Demo Dark" Design Dark }
      scene Main() { Title "Main" render Swatch(Tint: glow) }
      view Swatch(Tint color default glow) { render Surface() [background Tint] }
      view Surface() {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    // The views carry no named style: which design a style entry is checked against is the design
    // validator's own selection, which does not yet see a refinement.
    Expect(validationErrorMessages(result)).toEqual([])
  })

  for (const order of [['First', 'Second'], ['Second', 'First']] as const) {
    Test(
      `rejects a shade one mounting design lacks whichever app is declared first (${order.join(', ')})`,
      async () => {
        const apps = {
          First:
            'app First { id "first" version "1.0.0" name "First" Navigator StackNav { Initial Main } Design Plain }',
          Second:
            'app Second { id "second" version "1.0.0" name "Second" Navigator StackNav { Initial Main } Design Rich }',
        }
        const result = await Validator.validateCode(`
        use StackNav from @tao/nav
        project design Plain {
          colors {
            accent #2f6b4f
            inkMuted #6b7280
          }
          styles { dot [width 8] }
        }
        project design Rich {
          colors {
            accent #2f6b4f { 20 #cfe3d8 }
            inkMuted #6b7280
          }
          styles { dot [width 8] }
        }
        ${apps[order[0]]}
        ${apps[order[1]]}
        scene Main() { Title "Main" render StatusBadge() }
        view StatusBadge() { render Badge("Soft", Tint: accent.20) }
        ${colorViews}
      `)

        Expect(validationErrorMessages(result)).toEqual([
          colorMessages.missingDesignColor('Plain', 'accent.20', 'StatusBadge'),
        ])
      },
    )
  }

  Test(
    'rejects text literals where a color is expected',
    rejects(
      colorApp(`
        view TextDefault(Tint color default "red") { render Surface() [background Tint] }
        view TextArgument() { render Badge("Final", Tint: "red") }
      `),
      typeValidationMessages.defaultParameterType('Tint', 'TextDefault.Tint', 'text'),
      invocationMessages.namedArgumentType('Badge', 'Tint', 'Badge.Tint', 'text'),
    ),
  )

  Test(
    'rejects an unknown name, a size, or a style where a design color is expected',
    rejects(
      colorApp(`
        view Misspelled() { render Badge("Final", Tint: acent) }
        view Size() { render Badge("Final", Tint: gutter) }
        view Style() { render Badge("Final", Tint: dot) }
      `),
      "No value or design color named 'acent' is in scope.",
      "No value or design color named 'gutter' is in scope.",
      "No value or design color named 'dot' is in scope.",
    ),
  )

  Test(
    'rejects a design color given where a text is expected, and one written outside an argument or default',
    rejects(
      colorApp(`
        view WrongParameter() { render Badge(Label: accent) }
        view Stored() {
          state Held = accent
          render Surface()
        }
      `),
      invocationMessages.namedArgumentType('Badge', 'Label', 'Badge.Label', 'color'),
      "No value named 'accent' is in scope.",
    ),
  )

  Test(
    'rejects a shade the design color does not declare and a shade on any other value',
    rejects(
      colorApp(`
        view MissingShade() { render Badge("Final", Tint: accent.21) }
        view ValueShade(Name text, Tint color default Name.2) { render Surface() [background Tint] }
      `),
      colorMessages.unknownShade('accent', 21),
      colorMessages.shadeOnValue('Name', 2),
    ),
  )

  Test('rejects a color type anywhere but a view parameter', async () => {
    const result = await Validator.validateCode(colorApp(`
      type Swatch is { Tint color }
      action Paint(Tint color) { }
    `))

    Expect(validationErrorMessages(result)).toEqual([colorMessages.colorTypePosition, colorMessages.colorTypePosition])
  })

  Test('rejects a clause value that names nothing in scope or is not a color', async () => {
    const result = await Validator.validateCode(colorApp(`
      view Unknown() { render Surface() [background Missing] }
      view Mistyped(Name text) { render Surface() [ink Name] }
    `))
    const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')

    // Neither word also reads as an unknown design token: the case already says it is a value.
    Expect(errors.map(diagnostic => [diagnostic.code, diagnostic.message])).toEqual([
      [designValidationCodes.unknownClauseValue, designMessages.unknownClauseValue('Missing')],
      [designValidationCodes.clauseValueType, designMessages.clauseValueType('Name', 'text')],
    ])
  })

  Test('asks for a clause head when a color value stands alone as an entry', async () => {
    const result = await Validator.validateCode(colorApp(`
      view Headless(Tint color default accent) { render Surface() [dot, Tint] }
    `))
    const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')

    Expect(errors.map(diagnostic => [diagnostic.code, diagnostic.message])).toEqual([
      [designValidationCodes.clauseValueNeedsHead, designMessages.clauseValueNeedsHead('Tint')],
    ])
  })
})

function themeDesign(name: string, extraColors = ''): string {
  return `
    project design ${name} {
      colors {
        ${extraColors}
        accent #2f6b4f { 20 #cfe3d8 }
        inkMuted #6b7280
        ink #111111
        inkDark #eeeeee
        schemeInk when Scheme is Dark inkDark / not ink
      }
      sizes { gutter 8.px }
      styles { dot [width 8, height 8] }
    }
  `
}

const colorViews = `
  view Badge(Label text, Tint color default inkMuted) { render Surface() [dot, background Tint] }
  view Dot(Tint color) { render Surface() [dot, background Tint] }
  view Surface() {
    render inject ${tsFence}
      return null
    ${fence}
  }
`

function colorApp(views: string): string {
  return `
    use StackNav from @tao/nav
    ${themeDesign('Theme')}
    app Demo { id "demo" version "1.0.0" name "Demo" Navigator StackNav { Initial Main } Design Theme }
    scene Main() { Title "Main" render Badge("Main") }
    ${colorViews}
    ${views}
  `
}
