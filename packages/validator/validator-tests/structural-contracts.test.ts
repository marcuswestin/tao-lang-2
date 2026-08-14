import { Describe, Expect, Test } from '@shared/test'
import { configurationValidationMessages } from '../validator-src/validators/configuration-validator'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { DialogueValidator } from '../validator-src/validators/dialogue-validator'
import { navigationValidationMessages } from '../validator-src/validators/navigation-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import {
  fence,
  testValidateCode,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
} from './test-validate'

Describe('Tao validator structural diagnostics', () => {
  Test('validates arbitrary self-hosted declaration contracts without shipped-name tables', async () => {
    await testValidateCode(`
      public type Presentable is ui | nav
      public nav Carousel {
        Initial key
        Display text
        @key {
          Label text
          Content Presentable
        }
        implement inject nav ${tsFence}
          return TR.NavKind.Selection()
        ${fence}
      }
      public datasource SnapshotStore {
        StorageKey text
        implement inject provider ${tsFence}
          return TR.DataProvider.Local()
        ${fence}
      }
      ui Home { render Empty() }
      let Main = Carousel {
        Initial @home
        Display "tabs"
        @home {
          Label "Home"
          Content Home
        }
      }
      app Demo {
        Name "Demo"
        Navigator Main
        Datasource SnapshotStore {
          StorageKey "demo"
        }
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)
  })

  Test('derives ordinary and keyed constructor diagnostics from their declarations', async () => {
    const invalid = await testValidateCodeWithErrors(`
      public type Presentable is ui | nav
      public nav Carousel {
        Initial key
        Display text
        @key {
          Label text
          Content Presentable
        }
        implement inject nav ${tsFence}
          return TR.NavKind.Selection()
        ${fence}
      }
      ui Home { render Empty() }
      let Bad = Carousel {
        Initial @missing
        Initial "not a key"
        Display 3
        Extra "unknown"
        @home {
          Label 4
          Content "not presentable"
          Extra "unknown"
        }
        @home {
          Label "Duplicate"
        }
      }
      let Empty = Carousel {
        Initial @home
        Display "tabs"
      }
      app Demo { Name "Demo" Navigator Bad }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(navigationValidationMessages.duplicateConfiguration('Carousel', 'Initial'))
    Expect(messages).toContain(navigationValidationMessages.configurationKeyType('Initial'))
    Expect(messages).toContain(navigationValidationMessages.configurationType('Display', 'text', 'number'))
    Expect(messages).toContain(navigationValidationMessages.unknownConfiguration('Carousel', 'Extra'))
    Expect(messages).toContain(navigationValidationMessages.duplicateConfigurationKey('Carousel', '@home'))
    Expect(messages).toContain(navigationValidationMessages.missingKeyedItem('Carousel'))
    Expect(messages).toContain(navigationValidationMessages.configurationType('Label', 'text', 'number'))
    Expect(messages).toContain(navigationValidationMessages.configurationType('Content', 'ui | nav', 'text'))
    Expect(messages).toContain(navigationValidationMessages.keyedItemConfiguration('Carousel', '@home', 'Extra'))
    Expect(messages).toContain(navigationValidationMessages.keyedItemMissing('Carousel', '@home', 'Content'))
    Expect(messages).toContain(
      navigationValidationMessages.unknownConfigurationKey('Carousel', 'Initial', '@missing'),
    )
  })

  Test('rejects with patches on non-configurable aliases and follows configurable alias chains', async () => {
    await testValidateCode(`
      use StackNav from @tao/nav
      let BaseNavigation = StackNav { Initial Home }
      let NavigationAlias = BaseNavigation
      let PatchedNavigation = NavigationAlias with { Initial Other }
      app Demo { Name "Demo" Navigator PatchedNavigation }
      ui Home { render Empty() }
      ui Other { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      let Plain = 5
      let Patched = Plain with { X: 1 }
      app Demo { Name "Demo" Navigator StackNav { Initial Home } }
      ui Home { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    Expect(validationErrorMessages(invalid)).toContain(navigationValidationMessages.patchTarget('Plain'))
  })

  Test('validates self-hosted declaration placement, visibility, shape, and protocol', async () => {
    const invalid = await testValidateCodeWithErrors(`
      nav HiddenNav {
        Initial key
        Initial text
        OrphanKey key
        @key { Label key Label text }
        @key { Content ui }
        implement inject provider ${tsFence} return null ${fence}
        implement inject nav ${tsFence} return null ${fence}
      }
      public datasource BadStore {
        @key { Label text }
        implement inject nav ${tsFence} return null ${fence}
      }
      view Owner {
        public nav NestedNav {
          implement inject nav ${tsFence} return null ${fence}
        }
        render Empty()
      }
      public datasource MissingImplementation {
        StorageKey text
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(configurationValidationMessages.visible('Nav'))
    Expect(messages).toContain(configurationValidationMessages.duplicateProperty('Initial'))
    Expect(messages).toContain(configurationValidationMessages.duplicateProperty('Label'))
    Expect(messages).toContain(configurationValidationMessages.duplicateKey)
    Expect(messages).toContain(configurationValidationMessages.duplicateImplementation)
    Expect(messages).toContain(configurationValidationMessages.protocol('HiddenNav', 'nav'))
    Expect(messages).toContain(configurationValidationMessages.datasourceKey)
    Expect(messages).toContain(configurationValidationMessages.protocol('BadStore', 'provider'))
    Expect(messages).toContain(configurationValidationMessages.topLevel('Nav'))
    Expect(messages).toContain(configurationValidationMessages.missingImplementation('MissingImplementation'))
    Expect(messages).toContain(configurationValidationMessages.keyProperty('Label'))
  })

  Test('validates dialogue ask bindings, response ownership, and enum-typed results', async () => {
    await testValidateCode(`
      enum ConfirmResult { Confirmed }
      view Editor {
        action Close {
          let Result = ask ConfirmClose("Draft")
          if Result is Confirmed { dismiss }
        }
        render Empty()
      }
      dialogue ConfirmClose Title is text responds ConfirmResult {
        action Confirm { respond Confirmed }
        action Cancel { respond }
        render Empty()
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      enum ConfirmResult { Confirmed }
      view Editor {
        action Broken {
          let Result = ask ConfirmClose()
          let Result = ask ConfirmClose("Draft")
          respond
        }
        render Empty()
      }
      dialogue ConfirmClose Title is text responds ConfirmResult {
        render Empty()
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)
    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(DialogueValidator.messages.missingArgument('ConfirmClose', 'Title'))
    Expect(messages).toContain(DialogueValidator.messages.duplicateResult('Result'))
    Expect(messages).toContain(DialogueValidator.messages.responseContext)
  })

  Test('validates overlay presentation with nearest and explicit navigation targets', async () => {
    await testValidateCode(`
      use StackNav from @tao/nav
      let TargetNav = StackNav { Initial Detail }
      app OverlayApp { Name "Overlay" Navigator StackNav { Initial Home } }
      ui Home {
        action Nearest { present Detail() as overlay }
        action Explicit { present Detail() as overlay in TargetNav }
        render Empty()
      }
      ui Detail { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      app OverlayApp { Name "Overlay" Navigator StackNav { Initial Home } }
      ui Home {
        action Open { present Detail() as overlay in Detail }
        render Empty()
      }
      ui Detail { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)
    Expect(validationErrorMessages(invalid)).toContain(navigationValidationMessages.presentationTarget('ui'))
  })

  Test('validates app-level keyed toast modifiers from rendered declarations', async () => {
    await testValidateCode(`
      use StackNav from @tao/nav
      app ToastApp { Name "Toast" Navigator StackNav { Initial Home } }
      ui Home { render Editor() }
      view Editor {
        action Save { present Saved() as toast (Key: "document-saved", Duration: 3) }
        action EmptyKey { present Saved() as toast (Key: "", Duration: 0) }
        render Empty()
      }
      ui Saved { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      let Target = StackNav { Initial Home }
      app ToastApp { Name "Toast" Navigator Target }
      ui Home {
        action BadKey { present Saved() as toast (Key: 3, Duration: 1) }
        action BadDuration { present Saved() as toast (Key: "saved", Duration: "soon") }
        action Negative { present Saved() as toast (Key: "saved", Duration: -1) }
        action Targeted { present Saved() as toast (Key: "saved", Duration: 1) in Target }
        render Empty()
      }
      ui Saved { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)
    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(navigationValidationMessages.toastKeyType('number'))
    Expect(messages).toContain(navigationValidationMessages.toastDurationType('text'))
    Expect(messages).toContain(navigationValidationMessages.toastDurationNegative)
    Expect(messages).toContain(navigationValidationMessages.toastTarget)
  })

  Test('limits target-only selection activation to ui actions', async () => {
    await testValidateCode(`
      use SelectionNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @workspace
        Display "tabs"
        @workspace { Label "Workspace" Content Home }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      ui Home {
        action Activate { present SelectionApp@workspace }
        render Empty()
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      use SelectionNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @workspace
        Display "tabs"
        @workspace { Label "Workspace" Content Home }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      view Home {
        action Activate { present SelectionApp@workspace }
        render Empty()
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)
    Expect(validationErrorMessages(invalid)).toContain(navigationValidationMessages.activationContext)
  })

  Test('limits replacement to actions inside visual declarations', async () => {
    await testValidateCode(`
      use StackNav from @tao/nav
      let SignedOutNav = StackNav { Initial SignedOut }
      app ReplaceApp { Name "Replace" Navigator StackNav { Initial Home } }
      ui Home {
        action Reset { replace SignedOutNav in ReplaceApp }
        render Empty()
      }
      ui SignedOut { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      let SignedOutNav = StackNav { Initial SignedOut }
      app ReplaceApp { Name "Replace" Navigator StackNav { Initial Home } }
      action Reset { replace SignedOutNav in ReplaceApp }
      ui Home { render Empty() }
      ui SignedOut { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    Expect(validationErrorMessages(invalid)).toContain(navigationValidationMessages.replaceContext)
  })

  Test('requires target-only selection keys from the root and every app variant', async () => {
    await testValidateCode(`
      use SelectionNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @workspace
        Display "tabs"
        @workspace { Label "Workspace" Content Home }
        @settings { Label "Settings" Content Settings }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      let SelectionDrawer = SelectionApp with {
        Navigator with { Display "drawer" }
      }
      let SelectionAlternate = SelectionApp with {
        Navigator SelectionNav {
          Initial @workspace
          Display "tabs"
          @workspace { Label "Workspace" Content Home }
          @other { Label "Other" Content Other }
        }
      }
      ui Home {
        action ActivateApp { present SelectionApp@workspace }
        render Empty()
      }
      ui Settings { render Empty() }
      ui Other { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const missingFromVariant = await testValidateCodeWithErrors(`
      use SelectionNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @workspace
        Display "tabs"
        @workspace { Label "Workspace" Content Home }
        @settings { Label "Settings" Content Settings }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      let SelectionLimited = SelectionApp with {
        Navigator SelectionNav {
          Initial @workspace
          Display "tabs"
          @workspace { Label "Workspace" Content Home }
        }
      }
      ui Home {
        action Activate { present SelectionApp@settings }
        render Empty()
      }
      ui Settings { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)
    Expect(validationErrorMessages(missingFromVariant)).toContain(
      navigationValidationMessages.unknownSelection('SelectionLimited', 'settings'),
    )

    const nonKeyedVariant = await testValidateCodeWithErrors(`
      use SelectionNav, StackNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @workspace
        Display "tabs"
        @workspace { Label "Workspace" Content Home }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      let SelectionStack = SelectionApp with {
        Navigator StackNav { Initial Home }
      }
      ui Home {
        action Activate { present SelectionApp@workspace }
        render Empty()
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)
    Expect(validationErrorMessages(nonKeyedVariant)).toContain(
      navigationValidationMessages.unknownSelection('SelectionStack', 'workspace'),
    )
  })

  Test('requires strict app targets to name the root declaration', async () => {
    const invalid = await testValidateCodeWithErrors(`
      use SelectionNav, SlotNav, StackNav from @tao/nav
      let ResetNav = StackNav { Initial Home }
      app StrictApp {
        Name "Strict"
        Navigator SelectionNav {
          Initial @workspace
          Display "tabs"
          @workspace { Label "Workspace" Content Home }
        }
        @window SlotNav { Initial Detail }
      }
      let StrictVariant = StrictApp with { Name "Strict variant" }
      ui Home {
        action Activate { present StrictVariant@workspace }
        action Open { present Detail() in StrictVariant@window }
        action Reset { replace ResetNav in StrictVariant }
        render Empty()
      }
      ui Detail { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const message = navigationValidationMessages.strictTargetDeclaration('StrictVariant')
    Expect(validationErrorMessages(invalid).filter(candidate => candidate === message)).toHaveLength(3)
  })

  Test('validates SelectionNav keyed items, initial key, display, labels, and content', async () => {
    await testValidateCode(`
      use SelectionNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @home
        Display "tabs"
        @home { Label "Home" Content Home }
        @settings { Label "Settings" Content Settings }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      ui Home { render Empty() }
      ui Settings { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      use SelectionNav from @tao/nav
      let BadNavigation = SelectionNav {
        Initial @missing
        Display 3
        @home { Label 4 Content "not presentable" Extra "unknown" }
        @home { Label "Duplicate" }
      }
      app SelectionApp { Name "Selection" Navigator BadNavigation }
    `)
    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(
      navigationValidationMessages.unknownConfigurationKey('SelectionNav', 'Initial', '@missing'),
    )
    Expect(messages).toContain(navigationValidationMessages.configurationType('Display', 'text', 'number'))
    Expect(messages).toContain(navigationValidationMessages.duplicateConfigurationKey('SelectionNav', '@home'))
    Expect(messages).toContain(navigationValidationMessages.configurationType('Label', 'text', 'number'))
    Expect(messages).toContain(navigationValidationMessages.configurationType('Content', 'ui | nav', 'text'))
    Expect(messages).toContain(navigationValidationMessages.keyedItemConfiguration('SelectionNav', '@home', 'Extra'))
    Expect(messages).toContain(navigationValidationMessages.keyedItemMissing('SelectionNav', '@home', 'Content'))
  })

  Test('validates root and relation queries with boolean cases and unconditional placement', async () => {
    await testValidateCode(`
      data Workspaces / Workspace { Name text Documents (auto-delete) }
      data Documents / Document {
        Title text
        Final yes / no Draft
        Workspace
      }
      app DataApp { view Main }
      view Main {
        query Workspaces { }
        render Text("Rows: { Workspaces.Count }")
      }
      view Detail Workspace {
        render Col() {
          Text("Before")
          query Drafts from Workspace.Documents { where is Draft }
          Text("Drafts: { Drafts.Count }")
          loop Drafts / Document { Text(Document.Title) }
        }
      }
      layout Col { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      data Workspaces / Workspace { Name text }
      app DataApp { view Main }
      view Main {
        render Col() {
          guard "stop" empty -> { Text("Stopped") }
          query Missing { }
        }
      }
      layout Col { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)
    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(dataValidationMessages.querySource)
    Expect(messages).toContain(dataValidationMessages.queryAfterControl)
  })

  Test('rejects invalid field modifiers, case collisions, and ambiguous owner-side cascades', async () => {
    const result = await testValidateCodeWithErrors(`
      data Parents / Parent {
        Name text
        Enabled yes / no Name (default true, relation Parents)
        Child (auto-delete)
        Children (auto-delete)
      }
      data Children / Child {
        Parent
        OtherParent (relation Parent)
      }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(dataValidationMessages.duplicateBooleanCase('Parent', 'Name'))
    Expect(messages).toContain(dataValidationMessages.booleanDefaultCase('Enabled'))
    Expect(messages).toContain(dataValidationMessages.relationModifier('Enabled'))
    Expect(messages).toContain(dataValidationMessages.autoDeleteOwner('Child'))
    Expect(messages).toContain(
      dataValidationMessages.ambiguousInverseRelation('Parent.Children', 'Child'),
    )
  })

  Test('validates tag attachment and the single direct row root required by tagged loops', async () => {
    await testValidateCode(`
      app TaggedApp { view Main }
      view Main {
        render Col() {
          #title
          Text("Title")
          #rows
          loop ["One"] / Row {
            Col() { Text(Row) }
          }
        }
      }
      layout Col { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    const invalid = await testValidateCodeWithErrors(`
      app TaggedApp { view Main }
      view Main {
        render Col() {
          #orphan
          let Label = "Rows"
          #multipleRoots
          loop ["One"] / Row {
            Text(Row)
            Text(Row)
          }
          #conditionalRoot
          loop ["Two"] / Row {
            when Row {
              empty -> { Text("Empty") }
              otherwise -> { Text(Row) }
            }
          }
        }
      }
      layout Col { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)
    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(ViewsValidator.messages.tagAttachment)
    Expect(messages.filter(message => message === ViewsValidator.messages.taggedLoopRoot)).toHaveLength(2)
  })

  Test('retires legacy query status and collection empty members while exposing stable entity IDs', async () => {
    const result = await testValidateCodeWithErrors(`
      data Items / Item { Title text }
      app DataApp { view MainView }
      view MainView {
        query Items { }
        render Stack(){
          Text(Items.Loading)
          Text(Items.Error)
          Text(Items.Empty)
          loop Items / Item { Text(Item.Id) }
        }
      }
      layout Stack { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(typeValidationMessages.memberNotItem('Loading'))
    Expect(messages).toContain(typeValidationMessages.memberNotItem('Error'))
    Expect(messages).toContain(typeValidationMessages.memberNotItem('Empty'))
    Expect(messages).not.toContain(typeValidationMessages.unknownMember('Item', 'Id'))
  })

  Test('scopes parameter defaults to preceding parameters only', async () => {
    const result = await testValidateCodeWithErrors(`
      app DefaultsApp { view MainView }
      view MainView { render inject ${tsFence} return null ${fence} }
      view Child First is text default "first", Second is text default First, Third is text default Fourth, Fourth is text default "fourth", Self is text default Self {
        render inject ${tsFence} return null ${fence}
      }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain("Could not resolve reference to ValueDeclaration named 'Fourth'.")
    Expect(messages).toContain("Could not resolve reference to ValueDeclaration named 'Self'.")
    Expect(messages).not.toContain("Could not resolve reference to ValueDeclaration named 'First'.")
  })
})
