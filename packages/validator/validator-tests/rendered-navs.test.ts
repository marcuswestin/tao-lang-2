import { Describe, Test } from '@shared/test'
import { AppValidator } from '../validator-src/validators/app-validator'
import { navigationValidationMessages } from '../validator-src/validators/navigation-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { accepts, rejects, stubContainer, stubView } from './test-validate'

const home = `
  ${stubView('Label', 'Value text')}
  ${stubContainer('Column')}
  scene Home() {
    Title "Home"
    render Label("Home")
  }
`

Describe('validator: rendered navs', () => {
  // `nav is scene is view`: a render site may name a nav declaration or a nav-typed parameter, and
  // a shell is then ordinary layout around it. A scene is still turned away, because a nav is the
  // one scene that supplies its own chrome.
  Test(
    'accepts a nav declaration and a nav-typed parameter as ordinary render children',
    accepts(`
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      app ShellApp { view Shell(Center) }
      scene Shell(Navigator nav) {
        render Column() {
          Navigator()
          Status()
        }
      }
      view Status() {
        render Column() {
          Center()
        }
      }
    `),
  )

  Test(
    'still rejects a scene composed inline beside a rendered nav',
    rejects(
      `
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      app ShellApp { view Shell }
      view Shell() {
        render Column() {
          Center()
          Home()
        }
      }
    `,
      ViewsValidator.messages.sceneComposed('Home'),
    ),
  )

  // A nav or a parameter renders as the value it was bound to, so the site passes nothing into it.
  Test(
    'rejects arguments, content, and events on a rendered value',
    rejects(
      `
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      app ShellApp { view Shell(Center, Label) }
      scene Shell(Navigator nav, Content view) {
        render Column() {
          Navigator("Home") {
            Label("Inside")
          }
          Content() {
            on press -> { }
          }
        }
      }
    `,
      navigationValidationMessages.valueRenderArguments('Navigator'),
      navigationValidationMessages.valueRenderContent('Navigator'),
      navigationValidationMessages.valueRenderContent('Content'),
    ),
  )

  // A nav's history lives on its one mount: it renders at most once, never in a loop, and never in
  // a conditional branch. Each is diagnosed at the render site, because the declaration is not wrong.
  Test(
    'rejects a nav rendered twice',
    rejects(
      `
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      app ShellApp { view Shell(Center) }
      scene Shell(Navigator nav) {
        render Column() {
          Navigator()
          Navigator()
        }
      }
      view Elsewhere() {
        render Column() {
          Center()
          Center()
        }
      }
    `,
      navigationValidationMessages.navRenderedTwice('Navigator'),
      navigationValidationMessages.navRenderedTwice('Center'),
    ),
  )

  Test(
    'rejects a nav rendered inside a loop',
    rejects(
      `
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      app ShellApp { view Shell(Center) }
      scene Shell(Navigator nav) {
        render Column() {
          loop ["one", "two"] / Item {
            Navigator()
          }
        }
      }
    `,
      navigationValidationMessages.navRenderedInLoop('Navigator'),
    ),
  )

  Test(
    'rejects a nav rendered inside a conditional branch',
    rejects(
      `
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      app ShellApp { view Shell(Center) }
      scene Shell(Navigator nav) {
        state Open = true
        render Column() {
          when Open {
            true -> { Navigator() }
            otherwise -> { Label("Closed") }
          }
        }
      }
    `,
      navigationValidationMessages.navRenderedConditionally('Navigator'),
    ),
  )

  // The bar beside the navigator may be conditional: only the navigator is held to the rule.
  Test(
    'accepts a conditional view beside an unconditional nav',
    accepts(`
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      app ShellApp { view Shell(Center) }
      scene Shell(Navigator nav) {
        state Open = true
        render Column() {
          Navigator()
          when Open {
            true -> { Label("Open") }
            otherwise -> { }
          }
        }
      }
    `),
  )

  // The app root is a view with arguments, and a variant rebinds it with the same spelling.
  Test(
    'accepts a variant that rebinds the root view and rejects one that leaves a parameter unbound',
    accepts(`
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      nav Other = StackNav { Initial Home }
      app ShellApp { view Shell(Center) }
      app OtherShellApp = ShellApp with {
        Name "Other"
        view Shell(Other)
      }
      scene Shell(Navigator nav) {
        render Column() {
          Navigator()
        }
      }
    `),
  )

  Test(
    'rejects a variant root view whose arguments do not bind',
    rejects(
      `
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav { Initial Home }
      app ShellApp { view Shell(Center) }
      app OtherShellApp = ShellApp with {
        view Shell("Other")
      }
      scene Shell(Navigator nav) {
        render Column() {
          Navigator()
        }
      }
    `,
      navigationValidationMessages.unmatchedArgument('Shell'),
      navigationValidationMessages.missingArgument('Shell', 'Navigator'),
    ),
  )

  Test(
    'rejects a root view statement outside an app value',
    rejects(
      `
      use StackNav from @tao/nav
      ${home}
      nav Center = StackNav {
        view Home
        Initial Home
      }
      app ShellApp { view Shell(Center) }
      scene Shell(Navigator nav) {
        render Column() {
          Navigator()
        }
      }
    `,
      AppValidator.messages.rootViewPlacement,
    ),
  )
})
