import { Packages } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Diagnostics, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { useValidationCodes } from '../validator-src/diagnostic-codes'
import { Validation } from '../validator-src/validation'
import Validator from '../validator-src/validator'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { AppValidator } from '../validator-src/validators/app-validator'
import { configurationValidationMessages } from '../validator-src/validators/configuration-validator'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { DialogueValidator } from '../validator-src/validators/dialogue-validator'
import { injectionValidationMessages } from '../validator-src/validators/injections-validator'
import { navigationValidationMessages } from '../validator-src/validators/navigation-validator'
import { projectValidationMessages } from '../validator-src/validators/project-validator'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { useValidationMessages, validateVisibleDeclarations } from '../validator-src/validators/use-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import {
  fence,
  testValidateCode,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
  withValidationParse,
} from './test-validate'

const wordFlowerPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao')
const typeSystemTestsPath = Repo.resolvePath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
const stateActionMvpPath = Repo.resolvePath('Apps/Test Apps/State Action MVP/State Action MVP.tao')
type ValidatedFiles = Awaited<ReturnType<typeof Workspace.validate>>

async function withValidatedFiles<
  const Files extends Record<string, string>,
  EntryFile extends keyof Files & string,
>(
  entryFile: EntryFile,
  files: Files,
  testFunction: (validated: ValidatedFiles) => Promise<void> | void,
): Promise<void> {
  await withTaoFiles('tao-validator-', files, async paths => {
    await testFunction(await Workspace.validate(paths[entryFile]))
  })
}

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

  Test('rejects prototype-mutating runtime scope names', async () => {
    const result = await testValidateCodeWithErrors(`
      app ScopeApp { view MainView }
      let __proto__ = "unsafe"
      view MainView __proto__ is text {
        render Text("Ready")
      }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages.filter(message => message === AliasesValidator.messages.reservedName('__proto__'))).toHaveLength(2)
  })

  Test('validates the current WordFlower app', async () => {
    const result = await Workspace.validate(wordFlowerPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the Type System Tests app', async () => {
    const result = await Workspace.validate(typeSystemTestsPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the Runtime Stdlib Tests app', async () => {
    const result = await Workspace.validate(runtimeStdlibTestsPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the State Action MVP app', async () => {
    const result = await Workspace.validate(stateActionMvpPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates an existing parser result', async () => {
    await withValidationParse(
      `
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('does not report duplicate visible declarations for repeated LSP document instances', async () => {
    const parserContext = Parser.createContext()
    const uri = Langium.URI.file('/__tao__/Views.tao')
    const documentOne = parserContext.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'public layout Box { }',
      uri,
    )
    const documentTwo = parserContext.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'public layout Box { }',
      uri,
    )
    const diagnostics = Validation.collectDiagnostics()
    const packagesContext = await Packages.createContext('/__tao__')
    const ctx = Validation.createContext(diagnostics.accept, {
      entryFilePath: uri.path,
      packagesContext,
      typir: {} as any,
      workspaceFiles: [
        documentOne.parseResult.value!,
        documentTwo.parseResult.value!,
      ],
    })

    validateVisibleDeclarations(ctx, documentOne.parseResult.value!)

    Expect(diagnostics.diagnostics).toEqual([])
  })

  Test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await testValidateCodeWithErrors('view Broken { render }')

    Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
    Expect(Diagnostics.hasSource(result.diagnostics, 'validator')).toBe(false)
  })

  Test('rejects unsupported top-level statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      render MainView()
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.topLevel)
  })

  Test('rejects file-level state declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      state Count = 0
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.topLevel)
  })

  Test('allows multiple app declarations for explicit selection', async () => {
    await testValidateCode(`
      view MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    await testValidateCode(`
      app First { view MainView }
      app Second { view MainView }
      view MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
  })

  Test('requires exactly one root view in app blocks', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { }
      view MainView { }
    `)
    const duplicate = await testValidateCodeWithErrors(`
      app MyApp {
        view MainView
        view OtherView
      }
      view MainView { }
      view OtherView { }
    `)

    Expect(validationErrorMessages(missing)).toContain(AppValidator.messages.appRootCount('MyApp', 0))
    Expect(validationErrorMessages(duplicate)).toContain(AppValidator.messages.appRootCount('MyApp', 2))
  })

  Test('rejects app root view declarations with parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView Label is text {
        render Text(Label)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.rootViewParameters('MyApp', 'MainView'))
  })

  Test('rejects non-root-view statements in app blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp {
        let Greeting = "Hello"
        view MainView
      }
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appBlock('MyApp'))
  })

  Test('rejects unsupported view body statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        view Nested { }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.viewBody)
  })

  Test('allows state and action declarations before a view render', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action AddOne {
          set Count += 1
        }
        render Text("ok")
      }
    `)
  })

  Test('rejects state and action declarations in layouts and render blocks', async () => {
    const layoutResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Stack()
      }
      layout Stack {
        state Count = 0
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const renderBlockResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text("hi") {
          action AddOne { }
        }
      }
    `)

    Expect(validationErrorMessages(layoutResult)).toContain(ViewsValidator.messages.layoutBody)
    Expect(validationErrorMessages(renderBlockResult)).toContain(ViewsValidator.messages.renderBlock)
  })

  Test('rejects bare child invocations directly in view bodies', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        Text("Hello")
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.viewBody)
  })

  Test('rejects duplicate view parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view Text }
      view Text Value is text, Value is number { }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.duplicateParameter('Value'))
    Expect(validationErrorMessages(result)).not.toContain(AliasesValidator.messages.duplicateName('Value'))
  })

  Test('rejects generated view prop names as parameter names', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view ChildrenView }
      view ChildrenView children is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view KeyView key is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view RefView ref is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view TaoPropView __tao is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('children'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('key'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('ref'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('__tao'))
  })

  Test('requires exactly one render statement in view bodies', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        let Greeting = "Hello"
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text("Hello")
        render Text("Again")
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(missing)).toContain(ViewsValidator.messages.renderCount('MainView'))
    Expect(validationErrorMessages(extra)).toContain(ViewsValidator.messages.renderCount('MainView'))
  })

  Test('requires render to be the last view body statement', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text("Hello")
        let Greeting = "Again"
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.renderLast)
  })

  Test('allows render inject as the only view body statement', async () => {
    await testValidateCode(`
      app MyApp { view Native }
      view Native {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects render inject mixed with view body statements', async () => {
    const withRender = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
        render MainView()
      }
    `)
    const withAlias = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        let Greeting = "Hello"
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(withRender)).toContain(ViewsValidator.messages.renderInjectPlacement)
    Expect(validationErrorMessages(withAlias)).toContain(ViewsValidator.messages.renderInjectPlacement)
  })

  Test('rejects render inject inside render child blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Container(){
          render inject ${tsFence}
            return null
          ${fence}
        }
      }
      view Container { }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.renderInjectPlacement)
  })

  Test('validates aliases and parameter references as render arguments', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      let Greeting = "Hello"
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view ParameterEcho Label is text {
        render Text(Label)
      }
      view MainView {
        let Local = "Local"
        render Stack(){
          Text(Greeting)
          ParameterEcho(Local)
        }
      }
    `)
  })

  Test('allows block-local aliases inside render child blocks', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        let Local = "Outer"
        render Stack(){
          let Local = "First"
          Text(Local)
          Stack(){
            let Local = "Nested"
            Text(Local)
          }
        }
      }
    `)
  })

  Test('requires render block aliases before child view invocations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack(){
          Text("First")
          let Later = "Second"
          Text(Later)
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.renderBlockAliasPlacement)
  })

  Test('allows the same let name in separate render child blocks', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack(){
          Stack(){
            let Local = "First"
            Text(Local)
          }
          Stack(){
            let Local = "Second"
            Text(Local)
          }
        }
      }
    `)
  })

  Test('rejects duplicate aliases in the same render child block', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack(){
          let Local = "First"
          let Local = "Second"
          Text(Local)
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Local'))
  })

  Test('rejects duplicate aliases in nested child invocation blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack(){
          Stack(){
            let Local = "First"
            let Local = "Second"
            Text(Local)
          }
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Local'))
  })

  Test('rejects nested child invocation aliases that shadow visible declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack(){
          Stack(){
            let Text = "shadow"
          }
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Text'))
  })

  Test('validates relative use imports across sibling files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('keeps type references distinct from same-name views', async () => {
    const result = await testValidateCode(`
      app MyApp { view MainView }
      type Card is text
      let CardValue = Card "Ada"
      view Card {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text(CardValue)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('resolves same-name qualified item types when renderables lack that scoped member', async () => {
    const result = await testValidateCode(`
      app MyApp { view MainView }
      type Card is {
        Name is text
      }
      let CardName = Card.Name "Ada"
      view Card Label is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text(CardName)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('allows imported types to share names with local values', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        let Name = Name "Ro"
        view MainView {
          render Text(Name)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        let Name = "Hidden"
        workspace type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('keeps invisible same-name imports out of value scopes', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        view MainView {
          render Text(Name)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        let Name = "Hidden"
        workspace type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes('Name'))).toBe(true)
      },
    )
  })

  Test('keeps invisible same-name imports out of type scopes', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        let DisplayName = Name "Ro"
        view MainView {
          render Text(DisplayName)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        type Name is text
        workspace let Name = "Visible"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes('Name'))).toBe(true)
      },
    )
  })

  Test('validates explicit Tao file use imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./Views.tao
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('validates source strings that import the Tao stdlib', async () => {
    await testValidateCode(`
      use Text from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text("Hello")
      }
    `)
  })

  Test('rejects file-private imports from another file in the same directory', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        view Text Value is text {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('Text'))
      },
    )
  })

  Test('rejects cross-file imports for declarations that are not visible', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./views
        view MainView { }
      `,
        'views/Views.tao': `
        view Text Value is text {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('Text'))
      },
    )
  })

  Test('reports validator errors inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value, Value ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        const diagnostic = result.diagnostics.find(diagnostic =>
          diagnostic.message === injectionValidationMessages.duplicateArgument('Value')
        )

        Expect(validationErrorMessages(result)).toContain(injectionValidationMessages.duplicateArgument('Value'))
        Expect(diagnostic?.filePath?.endsWith('/Views.tao')).toBe(true)
      },
    )
  })

  Test('reports parser errors inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': 'view Text Value is text {',
      },
      async result => {
        Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
      },
    )
  })

  Test('keeps parser errors from different imported files distinct', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use BrokenOne from ./one
        use BrokenTwo from ./two
        view MainView { }
      `,
        'one/BrokenOne.tao': 'view BrokenOne {',
        'two/BrokenTwo.tao': 'view BrokenTwo {',
      },
      async result => {
        const parserDiagnostics = Diagnostics.errors(result.diagnostics, 'parser')

        Expect(parserDiagnostics).toHaveLength(2)
        Expect(new Set(parserDiagnostics.map(diagnostic => diagnostic.filePath)).size).toBe(2)
      },
    )
  })

  Test('reports unresolved references inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render MissingView()
        }
      `,
      },
      async result => {
        Expect(Diagnostics.hasMessageContaining(Diagnostics.errors(result.diagnostics, 'linker'), 'MissingView')).toBe(
          true,
        )
      },
    )
  })

  Test('rejects names imported by more than one use statement', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.repeatedImport('Text'))
      },
    )
  })

  Test('rejects imports that collide with declarations in the importing file', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
      app MyApp { view MainView }
      use Text from ./Views.tao
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text("Hello")
      }
    `,
        'Views.tao': `
      workspace view Text Value is text {
        render inject Value ${tsFence}
          return <RN.Text>{Value}</RN.Text>
        ${fence}
      }
    `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.localDeclarationCollision('Text'))
      },
    )
  })

  Test('rejects app imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use OtherApp from ./Other.tao
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'Other.tao': `
        app OtherApp { view OtherView }
        view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.appImport('OtherApp'))
      },
    )
  })

  Test('allows test files to import apps from the same directory', async () => {
    await withValidatedFiles(
      'Main.test.tao',
      {
        'Main.test.tao': `
        use MyApp from ./

        test "Smoke" {
          check "renders" {
            run MyApp
            expect text "Hello"
          }
        }
      `,
        'Main.tao': `
        app MyApp { view MainView }
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('does not let inline tests import app declarations outside the entry file', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use OtherView from ./Other.tao
        view MainView {
          render OtherView()
        }
        test "inline smoke" {
          check "renders" {
            run MyApp
            expect text "Hello"
          }
        }
      `,
        'Other.tao': `
        app OtherApp { view OtherView }
        workspace view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appEntryFile('OtherApp'))
      },
    )
  })

  Test('does not let test sidecars relax app placement outside their directory', async () => {
    await withValidatedFiles(
      'Main.test.tao',
      {
        'Main.test.tao': `
        use MyApp from ./
        use OtherView from ./nested/Other.tao

        test "sidecar smoke" {
          check "renders" {
            run MyApp
            expect text "Hello"
          }
        }
      `,
        'Main.tao': `
        app MyApp { view MainView }
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'nested/Other.tao': `
        app OtherApp { view OtherView }
        workspace view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appEntryFile('OtherApp'))
      },
    )
  })

  Test('validates v0 test check run structure', async () => {
    const missingCheck = await testValidateCodeWithErrors(`
      test "Smoke" { }
    `)
    const missingRun = await testValidateCodeWithErrors(`
      test "Smoke" {
        check "missing run" {
          expect text "Hello"
        }
      }
    `)
    const duplicateRun = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "duplicate run" {
          run MyApp
          run MyApp
        }
      }
    `)
    const expectationBeforeRun = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "ordered run" {
          expect text "Hello"
          run MyApp
        }
      }
    `)
    const pressBeforeRun = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "ordered press" {
          press text "Add"
          run MyApp
        }
      }
    `)
    const nonAppRun = await testValidateCodeWithErrors(`
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "non app" {
          run MainView
        }
      }
    `)
    Expect(validationErrorMessages(missingCheck)).toContain(testValidationMessages.missingCheck('Smoke'))
    const missingRunMessages = validationErrorMessages(missingRun)
    Expect(missingRunMessages).toContain(testValidationMessages.missingRun('missing run'))
    Expect(missingRunMessages).not.toContain(testValidationMessages.expectationBeforeRun)
    Expect(validationErrorMessages(duplicateRun)).toContain(testValidationMessages.duplicateRun('duplicate run'))
    Expect(validationErrorMessages(expectationBeforeRun)).toContain(testValidationMessages.expectationBeforeRun)
    Expect(validationErrorMessages(pressBeforeRun)).toContain(testValidationMessages.expectationBeforeRun)
    const nonAppRunMessages = validationErrorMessages(nonAppRun)
    Expect(
      nonAppRunMessages.some(message => message.includes('AppValueDeclaration') && message.includes('MainView')),
    ).toBe(true)
    Expect(nonAppRunMessages).not.toContain(testValidationMessages.runTarget('MainView'))
  })

  Test('validates placeholder selectors, input-value selectors, and standalone test back', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view MainView { render inject ${tsFence}\nreturn null\n${fence} }
      test "Input" {
        check "selectors" {
          run MyApp
          enter "Draft" into placeholder "Title"
          submit placeholder "Title"
          expect placeholder "Title"
          expect input placeholder "Title" value "Draft"
          back
        }
      }
    `)
    const backBeforeRun = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView { render inject ${tsFence}\nreturn null\n${fence} }
      test "Navigation" {
        check "order" {
          back
          run MyApp
        }
      }
    `)

    Expect(validationErrorMessages(backBeforeRun)).toContain(testValidationMessages.expectationBeforeRun)
  })

  Test('validates v0 test statement placement', async () => {
    const checkAtTopLevel = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      check "orphan" {
        run MyApp
      }
    `)
    const runInTestBlock = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        run MyApp
      }
    `)
    const expectationAtTopLevel = await testValidateCodeWithErrors(`
      expect text "Hello"
    `)
    const pressAtTopLevel = await testValidateCodeWithErrors(`
      press text "Add"
    `)
    const aliasInCheckBlock = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "renders" {
          let Message = "Hello"
          run MyApp
        }
      }
    `)
    const nestedTest = await testValidateCodeWithErrors(`
      test "Outer" {
        test "Inner" { }
      }
    `)

    Expect(validationErrorMessages(checkAtTopLevel)).toContain(testValidationMessages.checkPlacement)
    const runInTestMessages = validationErrorMessages(runInTestBlock)
    Expect(runInTestMessages).toContain(testValidationMessages.testBlock('Smoke'))
    Expect(runInTestMessages).not.toContain(testValidationMessages.runPlacement)
    Expect(validationErrorMessages(expectationAtTopLevel)).toContain(testValidationMessages.expectationPlacement)
    Expect(validationErrorMessages(pressAtTopLevel)).toContain(testValidationMessages.pressPlacement)
    Expect(validationErrorMessages(aliasInCheckBlock)).toContain(testValidationMessages.checkBlock('renders'))
    const nestedTestMessages = validationErrorMessages(nestedTest)
    Expect(nestedTestMessages).toContain(testValidationMessages.testPlacement)
    Expect(nestedTestMessages).toContain(testValidationMessages.testBlock('Outer'))
  })

  Test('rejects app declarations outside the entry file', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use OtherView from ./Other.tao
        view MainView {
          render OtherView()
        }
      `,
        'Other.tao': `
        app OtherApp { view OtherView }
        workspace view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appEntryFile('OtherApp'))
      },
    )
  })

  Test('rejects app declarations inside packages', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use MainView from @bar
      `,
        'packages/@bar/Main.tao': `
        app PackageApp { view MainView }
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appPackage('PackageApp'))
      },
    )
  })

  Test('rejects imports that match multiple visible declarations in an import target', async () => {
    const sharedTextSource = `
      workspace view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./views
        view MainView {
          render Text("Hello")
        }
      `,
        'views/Views.tao': sharedTextSource,
        'views/MoreViews.tao': sharedTextSource,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.ambiguousImport('Text', './views'))
      },
    )
  })

  Test('allows file-level aliases that reference imported aliases', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Greeting from ./
        let Local = Greeting
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
        view MainView {
          render Text(Local)
        }
      `,
        'Views.tao': `
        // Padding comments keep this declaration at a larger source offset than the
        // importing file's references, which used to trip the declaration-order check.
        // More padding.
        // More padding.
        workspace let Greeting = "Hello"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('validates bare use imports across a whole package', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app PackageApp { view MainView }
        use MainView from @foo/forms
      `,
        'features/@foo/Title.tao': `
        package let PackageTitle = "Package title"
      `,
        'features/@foo/forms/Main.tao': `
        use PackageTitle
        workspace view MainView {
          render Text(PackageTitle)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('resolves package imports through the project package index', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app IndexedPackageApp { view MainView }
        use MainView from @bar/views
      `,
        'deep/packages/@bar/views/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('resolves package paths through folders instead of file basenames', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app FolderTargetApp { view MainView }
        use Chosen from @foo/Widget
        use FileOnly from @foo/FileOnly
        use ExplicitFile from @foo/ExplicitFile.tao
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@foo/Widget.tao': `
        workspace let Chosen = "Wrong file target"
      `,
        'features/@foo/Widget/Index.tao': `
        workspace let Chosen = "Folder target"
      `,
        'features/@foo/FileOnly.tao': `
        workspace let FileOnly = "File target"
      `,
        'features/@foo/ExplicitFile.tao': `
        workspace let ExplicitFile = "Explicit file target"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.unresolvedImport('@foo/FileOnly'))
        Expect(validationErrorMessages(result)).toContain(
          useValidationMessages.unresolvedImport('@foo/ExplicitFile.tao'),
        )
      },
    )
  })

  Test('rejects duplicate package names in the package index', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app DuplicatePackageApp { view MainView }
        use MainView from @bar
      `,
        'one/@bar/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'two/@bar/Main.tao': `
        workspace view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes("Package '@bar' is ambiguous"))).toBe(
          true,
        )
      },
    )
  })

  Test('rejects relative imports that cross package boundaries', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app BoundaryApp { view MainView }
        use MainView from ./features/@bar
      `,
        'features/@bar/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.packageBoundary('./features/@bar'))
      },
    )
  })

  Test('keeps package-visible declarations out of cross-package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app VisibilityApp { view MainView }
        use MainView from @bar
      `,
        'features/@bar/Main.tao': `
        package view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('MainView'))
      },
    )
  })

  Test('does not include nested package folders in bare package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app NestedPackageApp { view MainView }
        use MainView from @outer
        use InnerView from @inner
      `,
        'features/@outer/Main.tao': `
        use NestedAlias
        workspace view MainView {
          render Text(NestedAlias)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@outer/@inner/Main.tao': `
        package let NestedAlias = "Nested"
        workspace view InnerView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(
          useValidationMessages.missingImport('NestedAlias', 'current package'),
        )
      },
    )
  })

  Test('does not load nested package files through bare package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app NestedPackageApp { view MainView }
        use MainView from @outer
      `,
        'features/@outer/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@outer/@inner/Broken.tao': 'view Broken {',
      },
      async result => {
        Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(false)
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('rejects duplicate visible declarations in sibling package files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app DuplicateVisibleApp { view MainView }
        use MainView from @foo
      `,
        'features/@foo/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@foo/First.tao': `
        package let Shared = "First"
      `,
        'features/@foo/Second.tao': `
        public let Shared = "Second"
      `,
      },
      async result => {
        const duplicateMessages = validationErrorMessages(result).filter(message =>
          message.startsWith("Visible declaration 'Shared' is declared more than once in folder ")
        )

        Expect(duplicateMessages).toHaveLength(2)
      },
    )
  })

  Test('validates local project metadata blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      project {
        name "One"
        name "Two"
        remote none
        remote none
        license MIT
        license Apache
        requires foo
      }
      project {
        name "Duplicate"
      }
      app MetadataApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateProject())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateName())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateRemote())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateLicense())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.unsupportedRequires())
  })
})

Describe('Tao validator use organization diagnostics', () => {
  Test('warns about unused imports with a quick-fix code', async () => {
    const result = await Validator.validateCode(`
      use Text, Stack from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text("hi")
      }
    `)
    const warning = result.diagnostics.find(diagnostic =>
      diagnostic.message === useValidationMessages.unusedImport('Stack')
    )

    Expect(validationErrorMessages(result)).toEqual([])
    Expect(warning?.severity).toBe('warning')
    Expect(warning?.code).toBe(useValidationCodes.unusedImport)
  })

  Test('treats imported shorthand item field types as used', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        use Name from ./Types.tao
        app MyApp { view MainView }
        type Person is {
          Name
        }
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'Types.tao': `
        workspace type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
        Expect(
          result.diagnostics.some(diagnostic => diagnostic.message === useValidationMessages.unusedImport('Name')),
        ).toBe(false)
      },
    )
  })

  Test('warns about use statements after other top-level statements', async () => {
    const result = await Validator.validateCode(`
      app MyApp { view MainView }
      use Text from @tao/ui
      view MainView {
        render Text("hi")
      }
    `)
    const warning = result.diagnostics.find(diagnostic => diagnostic.message === useValidationMessages.useOutOfSection)

    Expect(validationErrorMessages(result)).toEqual([])
    Expect(warning?.severity).toBe('warning')
    Expect(warning?.code).toBe(useValidationCodes.useOutOfSection)
  })

  Test('reports no organization warnings for a canonical import section', async () => {
    const result = await Validator.validateCode(`
      use Text from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text("hi")
      }
    `)

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning')).toEqual([])
  })
})

Describe('Tao validator review regressions', () => {
  Test('queries resolve imported plural data declarations', async () => {
    await withValidatedFiles('Main.tao', {
      'Schema.tao': `
        workspace data Workspaces / Workspace { Name text }
      `,
      'Main.tao': `
        use Workspaces from ./Schema

        app ImportApp { view Main }
        view Main {
          query Workspaces { }
          render Text("Rows: { Workspaces.Count }")
        }
        view Text Value is text { render inject ${tsFence} return null ${fence} }
      `,
    }, async validated => {
      Expect(validationErrorMessages(validated)).toEqual([])
    })
  })

  Test('rejects duplicate tags in the same lexical block', async () => {
    const result = await testValidateCodeWithErrors(`
      app TagApp { view Main }
      view Main {
        render Col() {
          #same
          Text("one")
          #same
          Text("two")
        }
      }
      layout Col { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.duplicateTag('#same'))
  })
})
