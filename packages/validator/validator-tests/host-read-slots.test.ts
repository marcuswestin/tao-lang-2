import { Describe, stubView, Test } from '@shared/test'
import { commandValidationMessages } from '../validator-src/validators/commands-validator'
import { configuredValueValidationMessages } from '../validator-src/validators/configured-values-validator'
import { declarationSlotValidationMessages } from '../validator-src/validators/declaration-slots-validator'
import { navigationValidationMessages } from '../validator-src/validators/navigation-validator'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { accepts, acceptsFiles, rejects } from './test-validate'

const leaf = stubView('Leaf')
const commandMemberNames = 'Title, Description, Summary, Label, Icon, Key, Enabled'

Describe('validator: host-read slots and commands', () => {
  Test(
    'accepts reactive Title, a bound command, and Toolbar references',
    accepts(`
      ${leaf}
      use primary from @tao/keys
      scene Home(Name text) {
        Title Name
        action Save(Value text) { }
        command SaveCommand() {
          Title "Save"
          Label when Name is empty "Create" / not "Save"
          Icon "checkmark"
          Key primary + "s"
          Enabled Name is empty
          do Save(Name)
        }
        Toolbar { SaveCommand }
        render Leaf()
      }
    `),
  )

  Test(
    'accepts an action-ascribed bare export used by a command intent',
    accepts(`
      ${leaf}
      let OpenUrl is action(text) = OpenUrl from ./OpenUrl.ts
      action Open() {
        do OpenUrl("https://example.com")
      }
      scene Home() {
        Title "Home"
        command OpenCommand() {
          Title "Open"
          Label "Open"
          do Open()
        }
        Toolbar { OpenCommand }
        render Leaf()
      }
    `),
  )

  Test(
    'reports a semantic placement diagnostic for a command in an app body',
    rejects(
      `
        ${leaf}
        action Save() { }
        app Demo {
          command SaveCommand() {
            Title "Save"
            do Save()
          }
          view Leaf
        }
      `,
      commandValidationMessages.placement,
    ),
  )

  Test(
    'rejects slot, metadata, and bound-action contract violations',
    rejects(
      `
        ${leaf}
        scene Home() {
          Title 1
          Title "duplicate"
          Unknown "value"
          action Save(Value text) { }
          command SaveCommand() {
            Title "Save"
            Icon false
            Mystery "x"
            Enabled "yes"
            do Save()
          }
          Toolbar { SaveCommand SaveCommand }
          render Leaf()
        }
      `,
      declarationSlotValidationMessages.type('Title', 'text', 'number'),
      declarationSlotValidationMessages.duplicate('scene', 'Title'),
      declarationSlotValidationMessages.unknown('scene', 'Unknown'),
      commandValidationMessages.memberType('Icon', 'text', 'boolean'),
      commandValidationMessages.memberType('Enabled', 'boolean', 'text'),
      commandValidationMessages.member('Mystery', commandMemberNames),
      declarationSlotValidationMessages.duplicateCommand('SaveCommand'),
      "Action Save is missing argument for parameter 'Value'.",
    ),
  )

  Test(
    'requires text values for navigation and toolbar journey steps',
    rejects(
      `
        ${leaf}
        let ExpectedTitle = "Home"
        app Demo { view Leaf }
        test Demo "chrome" {
          run Demo
          expect navigation title ExpectedTitle
          expect toolbar command false enabled
          press toolbar command 2
        }
      `,
      testValidationMessages.navigationValueLiteral,
      testValidationMessages.navigationValueType('number'),
      testValidationMessages.navigationValueType('boolean'),
    ),
  )

  Test(
    'propagates StackNav context through rendered views before contextual pushes',
    rejects(
      `
        use StackNav from @tao/nav
        ${leaf}

        nav Main = StackNav { Initial WorkspaceList }

        scene WorkspaceList() {
          Title "Workspaces"
          render WorkspaceRow()
        }

        view WorkspaceRow() {
          action Open() { present WorkspaceDetail() }
          render Leaf()
        }

        scene WorkspaceDetail() {
          render Leaf()
        }
      `,
      navigationValidationMessages.missingHostTitle('WorkspaceDetail'),
    ),
  )

  Test(
    'does not impose the stdlib StackNav requirement on a same-named custom nav',
    acceptsFiles({
      'Main.tao': `
        ${leaf}
        type StackNav is nav with {
          Initial view
          nav StackNavKind from ./CustomNav.ts
        }
        nav Main = StackNav { Initial Untitled }
        scene Untitled() { render Leaf() }
      `,
      'CustomNav.ts': 'export const StackNavKind = {}',
    }),
  )

  Test(
    'inherits the stdlib StackNav requirement through nominal derivation',
    rejects(
      `
        use StackNav from @tao/nav
        ${leaf}
        type DerivedStack is StackNav with { }
        nav Main = DerivedStack { Initial Untitled }
        scene Untitled() { render Leaf() }
      `,
      navigationValidationMessages.missingHostTitle('Untitled'),
    ),
  )

  Test(
    'accepts inherited view host slots on a configured nav value',
    accepts(`
      use StackNav from @tao/nav
      ${leaf}
      nav Main = StackNav {
        Initial Home
        Title "Main"
        Toolbar []
      }
      scene Home() {
        Title "Home"
        render Leaf()
      }
    `),
  )

  Test(
    'rejects malformed configured-nav Toolbar reference blocks',
    rejects(
      `
        use StackNav from @tao/nav
        ${leaf}
        nav Main = StackNav {
          Initial Home
          Toolbar { Card, NeedsDocument, Ready, Ready }
          Title { Ready }
          Bogus { Ready }
        }
        data Documents / Document {
          Title text
        }
        action Run() { }
        command NeedsDocument(Document) {
          Title "Needs a document"
          do Run()
        }
        command Ready() {
          Title "Ready"
          do Run()
        }
        scene Card() {
          Title "Card"
          render Leaf()
        }
        scene Home() {
          Title "Home"
          render Leaf()
        }
      `,
      configuredValueValidationMessages.toolbarReference,
      configuredValueValidationMessages.toolbarUnfilled('NeedsDocument', 'Document'),
      configuredValueValidationMessages.duplicateToolbarReference('Ready'),
      configuredValueValidationMessages.configurationBlock('StackNav', 'Title'),
      configuredValueValidationMessages.unknownConfiguration('StackNav', 'Bogus'),
    ),
  )

  Test(
    'requires a nested configured nav to describe itself without bubbling a child title',
    rejects(
      `
        use StackNav from @tao/nav
        ${leaf}
        nav Child = StackNav { Initial ChildHome }
        nav Parent = StackNav { Initial Child }
        scene ChildHome() {
          Title "Child home"
          render Leaf()
        }
      `,
      navigationValidationMessages.missingNavHostTitle('Child'),
    ),
  )

  Test(
    'requires an inline nav used as Stack Initial to configure its own Title',
    rejects(
      `
        use StackNav, SlotNav from @tao/nav
        ${leaf}
        nav Parent = StackNav {
          Initial SlotNav { Initial Home }
        }
        scene Home() {
          Title "Home"
          render Leaf()
        }
      `,
      navigationValidationMessages.missingNavHostTitle('SlotNav'),
    ),
  )

  Test(
    'accepts inline and named-refined Stack destinations with occurrence-owned Titles',
    accepts(`
      use StackNav, SlotNav from @tao/nav
      ${leaf}
      nav ChildBase = SlotNav { Initial Home }
      nav Child = ChildBase with { Title "Refined" }
      nav InlineParent = StackNav {
        Initial SlotNav { Initial Home, Title "Inline" }
      }
      nav RefinedParent = StackNav {
        Initial Child
      }
      scene Home() {
        Title "Home"
        render Leaf()
      }
    `),
  )

  Test(
    'requires Title at a strict app auxiliary Stack presentation usage',
    rejects(
      strictAuxiliaryPresentation(''),
      navigationValidationMessages.missingHostTitle('Untitled'),
    ),
  )

  Test(
    'accepts a titled destination presented into a strict app auxiliary Stack',
    accepts(strictAuxiliaryPresentation('Title "Detail"')),
  )

  Test(
    'propagates Stack reachability through a strict app auxiliary presentation',
    rejects(
      `
        use StackNav from @tao/nav
        ${leaf}
        app Demo {
          Name "Demo"
          Navigator StackNav { Initial Home }
          @detail StackNav { Initial AuxiliaryRoot }
        }
        scene Home() {
          Title "Home"
          action Open() { present ScreenA() in Demo@detail }
          render Leaf()
        }
        scene AuxiliaryRoot() {
          Title "Auxiliary"
          render Leaf()
        }
        scene ScreenA() {
          Title "First"
          action Continue() { present ScreenB() }
          render Leaf()
        }
        scene ScreenB() {
          render Leaf()
        }
      `,
      navigationValidationMessages.missingHostTitle('ScreenB'),
    ),
  )

  for (const mode of ['sheet', 'overlay'] as const) {
    Test(
      `does not require Title for a ${mode} presented into a Stack target`,
      accepts(`
        use StackNav from @tao/nav
        ${leaf}
        app Demo {
          Name "Demo"
          Navigator StackNav { Initial Home }
          @detail StackNav { Initial AuxiliaryRoot }
        }
        scene Home() {
          Title "Home"
          action Open() { present Modal() as ${mode} in Demo@detail }
          render Leaf()
        }
        scene AuxiliaryRoot() {
          Title "Auxiliary"
          render Leaf()
        }
        scene Modal() { render Leaf() }
      `),
    )

    Test(
      `retains Stack push context inside a target-less ${mode}`,
      rejects(
        `
          use StackNav from @tao/nav
          ${leaf}
          nav Main = StackNav { Initial Home }
          scene Home() {
            Title "Home"
            action Open() { present Modal() as ${mode} }
            render Leaf()
          }
          scene Modal() {
            action Continue() { present Untitled() }
            render Leaf()
          }
          scene Untitled() { render Leaf() }
        `,
        navigationValidationMessages.missingHostTitle('Untitled'),
      ),
    )
  }

  Test(
    'requires Title when a Stack refinement patch replaces Initial',
    rejects(
      `
        use StackNav from @tao/nav
        ${leaf}
        nav Base = StackNav { Initial Home }
        nav Patched = Base with { Initial Untitled }
        scene Home() {
          Title "Home"
          render Leaf()
        }
        scene Untitled() { render Leaf() }
      `,
      navigationValidationMessages.missingHostTitle('Untitled'),
    ),
  )

  Test(
    'requires Title through a view-typed Initial alias',
    rejects(
      `
        use StackNav from @tao/nav
        ${leaf}
        let Destination is view = Untitled
        nav Main = StackNav { Initial Destination }
        scene Untitled() { render Leaf() }
      `,
      navigationValidationMessages.missingHostTitle('Untitled'),
    ),
  )
})

function strictAuxiliaryPresentation(detailTitle: string): string {
  return `
    use StackNav from @tao/nav
    ${leaf}
    app Demo {
      Name "Demo"
      Navigator StackNav { Initial Home }
      @detail StackNav { Initial AuxiliaryRoot }
    }
    scene Home() {
      Title "Home"
      action Open() { present Untitled() in Demo@detail }
      render Leaf()
    }
    scene AuxiliaryRoot() {
      Title "Auxiliary"
      render Leaf()
    }
    scene Untitled() {
      ${detailTitle}
      render Leaf()
    }
  `
}
