import { Describe, Test } from '@shared/test'
import { DesignValidator } from '../validator-src/validators/design-validator'
import { accepts, fence, rejects, tsFence } from './test-validate'

const messages = DesignValidator.messages

Describe('validator: minimal design', () => {
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
      view Main() { render Surface() [panel] }
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
    view Main() { ${body} }
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
