import { Describe, Expect, primitiveAppValueSpellings, Test } from '@shared/test'
import { completenessValidationMessages } from '../validator-src/validators/completeness-validator'
import { configurationValidationMessages } from '../validator-src/validators/configuration-validator'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import { configuredValueValidationMessages } from '../validator-src/validators/configured-values-validator'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { navigationValidationMessages } from '../validator-src/validators/navigation-validator'
import { ResponsesValidator } from '../validator-src/validators/responses-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import {
  accepts,
  app,
  rejects,
  stubContainer,
  stubView,
  testValidateCodeWithErrors,
  validationErrorMessages,
} from './test-validate'

Describe('validator: declaration contracts', () => {
  Test(
    'accepts complete navigation references in every primitive app value spelling',
    accepts(primitiveAppValueSpellings(implementation('nav'))),
  )

  Test(
    'rejects non-navigation references in primitive app values',
    rejects(
      `
        let NotNavigation = "not navigation"
        workspace let BadApp = app {
          Name "Bad"
          Navigator NotNavigation
        }
      `,
      configuredItemValidationMessages.constructorShape('Navigator', 'nav'),
    ),
  )

  Test(
    'infers bare app slot blocks from the slot name and primitive role',
    accepts(`
      public type Navigator is nav with {
        Initial view
        ${implementation('nav')}
      }
      public type Datasource is datasource with {
        StorageKey text
        supports { }
        ${implementation('provider')}
      }
      app Demo {
        Name "Demo"
        Navigator { Initial Home }
        Datasource { StorageKey "demo" }
      }
      view Home() { render Empty() }
      ${stubView('Empty')}
    `),
  )

  Test(
    'rejects a bare app slot block without its uniquely named declaration',
    rejects(
      `
        app Demo { Name "Demo" Navigator { Initial Home } }
        view Home() { render Empty() }
        ${stubView('Empty')}
      `,
      configuredItemValidationMessages.inferredConstructorContext,
    ),
  )

  Test(
    'rejects incomplete declarations used as values',
    rejects(
      `
        use StackNav from @tao/nav
        app Demo { Name "Demo" Navigator StackNav { Initial Detail } }
        view Detail(Label text) { render Empty() }
        ${stubView('Empty')}
      `,
      completenessValidationMessages.incomplete('Detail', ['Label']),
    ),
  )

  Test(
    'rejects direct primitive values that leave their implementation slot unfilled',
    rejects(
      `
        nav EmptyNavigation { }
        datasource EmptyDatasource { }
      `,
      completenessValidationMessages.incomplete('EmptyNavigation', ['implement']),
      completenessValidationMessages.incomplete('EmptyDatasource', ['implement']),
    ),
  )

  Test(
    'requires direct app configurations to fill their supplied slots',
    rejects(
      `
        use StackNav from @tao/nav
        app Demo { Name "Demo" Navigator StackNav { } }
      `,
      configuredValueValidationMessages.missingConfiguration('StackNav', 'Initial'),
    ),
  )

  Test(
    'accepts arbitrary self-hosted declaration contracts without shipped-name tables',
    accepts(`
      public type Carousel is nav with {
        Initial key
        Display text
        @key {
          Label text
          Content view
        }
        ${implementation('nav')}
      }
      public type SnapshotStore is datasource with {
        StorageKey text
        supports { }
        ${implementation('provider')}
      }
      view Home() { render Empty() }
      let Main = Carousel {
        Initial @home
        Display "tabs"
        @home { Label "Home" Content Home }
      }
      app Demo {
        Name "Demo"
        Navigator Main
        Datasource SnapshotStore { StorageKey "demo" }
      }
      ${stubView('Empty')}
    `),
  )

  const carouselCases: ReadonlyArray<readonly [name: string, configuration: string, message: string]> = [
    [
      'duplicate ordinary configuration properties',
      'Initial @home Initial @home Display "tabs" @home { Label "Home" Content Home }',
      navigationValidationMessages.duplicateConfiguration('Carousel', 'Initial'),
    ],
    [
      'non-key values for key configuration properties',
      'Initial "home" Display "tabs" @home { Label "Home" Content Home }',
      navigationValidationMessages.configurationKeyType('Initial'),
    ],
    [
      'ordinary configuration values of the wrong type',
      'Initial @home Display 3 @home { Label "Home" Content Home }',
      navigationValidationMessages.configurationType('Display', 'text', 'number'),
    ],
    [
      'unknown ordinary configuration properties',
      'Initial @home Display "tabs" Extra "unknown" @home { Label "Home" Content Home }',
      navigationValidationMessages.unknownConfiguration('Carousel', 'Extra'),
    ],
    [
      'duplicate keyed items',
      'Initial @home Display "tabs" @home { Label "Home" Content Home } @home { Label "Again" Content Home }',
      navigationValidationMessages.duplicateConfigurationKey('Carousel', '@home'),
    ],
    [
      'missing keyed items',
      'Initial @home Display "tabs"',
      navigationValidationMessages.missingKeyedItem('Carousel'),
    ],
    [
      'keyed item properties of the wrong primitive type',
      'Initial @home Display "tabs" @home { Label 4 Content Home }',
      navigationValidationMessages.configurationType('Label', 'text', 'number'),
    ],
    [
      'keyed item properties of the wrong union type',
      'Initial @home Display "tabs" @home { Label "Home" Content "not presentable" }',
      navigationValidationMessages.configurationType('Content', 'view', 'text'),
    ],
    [
      'unknown keyed item properties',
      'Initial @home Display "tabs" @home { Label "Home" Content Home Extra "unknown" }',
      navigationValidationMessages.keyedItemConfiguration('Carousel', '@home', 'Extra'),
    ],
    [
      'missing keyed item properties',
      'Initial @home Display "tabs" @home { Label "Home" }',
      navigationValidationMessages.keyedItemMissing('Carousel', '@home', 'Content'),
    ],
    [
      'initial keys absent from keyed items',
      'Initial @missing Display "tabs" @home { Label "Home" Content Home }',
      navigationValidationMessages.unknownConfigurationKey('Carousel', 'Initial', '@missing'),
    ],
  ]

  for (const [name, configuration, message] of carouselCases) {
    Test(`derives ${name} from a self-hosted declaration`, rejects(carouselApp(configuration), message))
  }

  Test(
    'follows configurable alias chains when applying patches',
    accepts(`
      use StackNav from @tao/nav
      let BaseNavigation = StackNav { Initial Home }
      let NavigationAlias = BaseNavigation
      let PatchedNavigation = NavigationAlias with { Initial Other }
      app Demo { Name "Demo" Navigator PatchedNavigation }
      scene Home() { Title "Home" render Empty() }
      scene Other() { Title "Other" render Empty() }
      ${stubView('Empty')}
    `),
  )

  Test(
    'rejects patches on non-configurable aliases',
    rejects(
      `
      use StackNav from @tao/nav
      let Plain = 5
      let Patched = Plain with { X: 1 }
      app Demo { Name "Demo" Navigator StackNav { Initial Home } }
      view Home() { render Empty() }
      ${stubView('Empty')}
    `,
      navigationValidationMessages.patchTarget('Plain'),
    ),
  )

  // A configurable declaration used only where it is declared needs no marker, the same as any
  // other declaration. It still emits its runtime identity inside its own module.
  Test(
    'accepts a file-private navigation declaration',
    accepts(`
      type HiddenNav is nav with { ${implementation('nav')} }
      let Hidden = HiddenNav { }
      app Demo { Name "Demo" Navigator Hidden }
      view Home() { render Empty() }
      ${stubView('Empty')}
    `),
  )

  const declarationCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'duplicate ordinary declaration properties',
      `public type Duplicate is nav with { Initial key Initial text ${implementation('nav')} }`,
      configurationValidationMessages.duplicateProperty('Initial'),
    ],
    [
      'duplicate keyed item properties',
      `public type Duplicate is nav with { @key { Label key Label text } ${implementation('nav')} }`,
      configurationValidationMessages.duplicateProperty('Label'),
    ],
    [
      'duplicate keyed item blocks',
      `public type Duplicate is nav with { @key { Label text } @key { Content view } ${implementation('nav')} }`,
      configurationValidationMessages.duplicateKey,
    ],
    [
      'duplicate implementation blocks',
      `public type Duplicate is nav with { ${implementation('provider')} ${implementation('nav')} }`,
      configurationValidationMessages.duplicateImplementation,
    ],
    [
      'navigation declarations with non-navigation implementations',
      `public type WrongProtocol is nav with { ${implementation('provider')} }`,
      configurationValidationMessages.protocol('WrongProtocol', 'nav'),
    ],
    [
      'keyed datasource declarations',
      `public type KeyedStore is datasource with { @key { Label text } ${implementation('provider')} }`,
      configurationValidationMessages.datasourceKey,
    ],
    [
      'datasource declarations with non-provider implementations',
      `public type WrongProtocol is datasource with { ${implementation('nav')} }`,
      configurationValidationMessages.protocol('WrongProtocol', 'provider'),
    ],
    [
      'nested navigation declarations',
      `view Owner() { public type NestedNav is nav with { ${implementation('nav')} } render Empty() } ${
        stubView('Empty')
      }`,
      configurationValidationMessages.topLevel('Nav'),
    ],
    [
      'declarations without implementation blocks',
      'public type MissingImplementation is datasource with { StorageKey text }',
      configurationValidationMessages.missingImplementation('MissingImplementation'),
    ],
    [
      'key-typed keyed item properties',
      `public type KeyedProperty is nav with { @key { Label key } ${implementation('nav')} }`,
      configurationValidationMessages.keyProperty('Label'),
    ],
  ]

  for (const [name, source, message] of declarationCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }

  const responseCases: ReadonlyArray<readonly [name: string, action: string, message: string]> = [
    [
      'asks with missing arguments',
      'let Result = ask ConfirmClose()',
      ResponsesValidator.messages.missingArgument('ConfirmClose', 'Title'),
    ],
    [
      'duplicate ask result bindings',
      'let Result = ask ConfirmClose("Draft") let Result = ask ConfirmClose("Again")',
      ResponsesValidator.messages.duplicateResult('Result'),
    ],
    [
      'asks that target a view without responds',
      'let Result = ask Empty()',
      ResponsesValidator.messages.askTarget('Empty'),
    ],
    [
      'responses outside responds-declaring views',
      'respond',
      ResponsesValidator.messages.responseContext,
    ],
  ]

  for (const [name, action, message] of responseCases) {
    Test(`rejects ${name}`, rejects(responseApp(action), message))
  }

  Test(
    'rejects overlay targets that are not navigation values',
    rejects(
      `
      use StackNav from @tao/nav
      app OverlayApp { Name "Overlay" Navigator StackNav { Initial Home } }
      view Home() {
        action Open() { present Detail() as overlay in Detail }
        render Empty()
      }
      view Detail() { render Empty() }
      ${stubView('Empty')}
    `,
      navigationValidationMessages.presentationTarget('view'),
    ),
  )

  const toastCases: ReadonlyArray<readonly [name: string, statement: string, message: string]> = [
    [
      'non-text toast keys',
      'present Saved() as toast (Key: 3, Duration: 1.s)',
      navigationValidationMessages.toastKeyType('number'),
    ],
    [
      'non-number toast durations',
      'present Saved() as toast (Key: "saved", Duration: "soon")',
      navigationValidationMessages.toastDurationType('text'),
    ],
    [
      'negative toast durations',
      'present Saved() as toast (Key: "saved", Duration: -1.s)',
      navigationValidationMessages.toastDurationNegative,
    ],
    [
      'explicit toast targets',
      'present Saved() as toast (Key: "saved", Duration: 1.s) in Target',
      navigationValidationMessages.toastTarget,
    ],
  ]

  for (const [name, statement, message] of toastCases) {
    Test(`rejects ${name}`, rejects(toastApp(statement), message))
  }

  Test(
    'rejects statically known action arguments at a restorable presentation usage site',
    rejects(
      `
        use StackNav from @tao/nav
        app RestoreApp { Name "Restore" Navigator StackNav { Initial Home } }
        view Home() {
          action Callback() { }
          action Open() { present Detail(Callback) }
          render Empty()
        }
        view Detail(Callback action) { render Empty() }
        ${stubView('Empty')}
      `,
      navigationValidationMessages.nonRestorableArgument('Detail', 'Callback'),
    ),
  )

  Test(
    'allows action arguments on toasts because toasts never enter restoration snapshots',
    accepts(`
      use StackNav from @tao/nav
      app ToastActions { Name "Toast actions" Navigator StackNav { Initial Home } }
      scene Home() {
        Title "Home"
        action Callback() { }
        action Open() { present Notice(Callback) as toast (Key: "notice", Duration: 1.s) }
        render Empty()
      }
      view Notice(Callback action) { render Empty() }
      ${stubView('Empty')}
    `),
  )

  Test(
    'rejects target-only selection activation outside view declarations',
    rejects(
      `
      use SelectionNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @workspace
        Display "tabs"
        @workspace { Label "Workspace" Content Home }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      action Activate() { present SelectionApp@workspace }
      view Home() { render Empty() }
      ${stubView('Empty')}
    `,
      navigationValidationMessages.activationContext,
    ),
  )

  Test(
    'accepts selection activation inside any view declaration',
    accepts(`
      use SelectionNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @workspace
        Display "tabs"
        @workspace { Label "Workspace" Content Home }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      view Home() {
        action Activate() { present SelectionApp@workspace }
        render Empty()
      }
      ${stubView('Empty')}
    `),
  )

  Test(
    'rejects replacement outside view declarations',
    rejects(
      `
      use StackNav from @tao/nav
      let SignedOutNav = StackNav { Initial SignedOut }
      app ReplaceApp { Name "Replace" Navigator StackNav { Initial Home } }
      action Reset() { replace SignedOutNav in ReplaceApp }
      view Home() { render Empty() }
      view SignedOut() { render Empty() }
      ${stubView('Empty')}
    `,
      navigationValidationMessages.replaceContext,
    ),
  )

  Test(
    'accepts target-only keys present in the root and every app variant',
    accepts(selectionVariantApp(
      `
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
    `,
      'workspace',
    )),
  )

  const selectionVariantCases: ReadonlyArray<
    readonly [name: string, variants: string, selection: string, variantName: string]
  > = [
    [
      'keys missing from a keyed app variant',
      `
        let SelectionLimited = SelectionApp with {
          Navigator SelectionNav {
            Initial @workspace
            Display "tabs"
            @workspace { Label "Workspace" Content Home }
          }
        }
      `,
      'settings',
      'SelectionLimited',
    ],
    [
      'keys on app variants with non-keyed navigation',
      'let SelectionStack = SelectionApp with { Navigator StackNav { Initial Home } }',
      'workspace',
      'SelectionStack',
    ],
  ]

  for (const [name, variants, selection, variantName] of selectionVariantCases) {
    Test(
      `rejects target-only ${name}`,
      rejects(
        selectionVariantApp(variants, selection),
        navigationValidationMessages.unknownSelection(variantName, selection),
      ),
    )
  }

  Test(
    'accepts every strict target that names a complete app value',
    accepts(`
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
      scene Home() {
        Title "Home"
        action Activate() { present StrictVariant@workspace }
        action Open() { present Detail() in StrictVariant@window }
        action Reset() { replace ResetNav in StrictVariant }
        render Empty()
      }
      view Detail() { render Empty() }
      ${stubView('Empty')}
    `),
  )

  const selectionNavCases: ReadonlyArray<readonly [name: string, configuration: string, message: string]> = [
    [
      'initial keys absent from keyed items',
      'Initial @missing Display "tabs" @home { Label "Home" Content Home }',
      navigationValidationMessages.unknownConfigurationKey('SelectionNav', 'Initial', '@missing'),
    ],
    [
      'display values of the wrong type',
      'Initial @home Display 3 @home { Label "Home" Content Home }',
      navigationValidationMessages.configurationType('Display', 'text', 'number'),
    ],
    [
      'duplicate keyed items',
      'Initial @home Display "tabs" @home { Label "Home" Content Home } @home { Label "Again" Content Home }',
      navigationValidationMessages.duplicateConfigurationKey('SelectionNav', '@home'),
    ],
    [
      'labels of the wrong type',
      'Initial @home Display "tabs" @home { Label 4 Content Home }',
      navigationValidationMessages.configurationType('Label', 'text', 'number'),
    ],
    [
      'content of the wrong type',
      'Initial @home Display "tabs" @home { Label "Home" Content "not presentable" }',
      navigationValidationMessages.configurationType('Content', 'view', 'text'),
    ],
    [
      'unknown keyed item properties',
      'Initial @home Display "tabs" @home { Label "Home" Content Home Extra "unknown" }',
      navigationValidationMessages.keyedItemConfiguration('SelectionNav', '@home', 'Extra'),
    ],
    [
      'missing keyed item properties',
      'Initial @home Display "tabs" @home { Label "Home" }',
      navigationValidationMessages.keyedItemMissing('SelectionNav', '@home', 'Content'),
    ],
  ]

  for (const [name, configuration, message] of selectionNavCases) {
    Test(`rejects SelectionNav ${name}`, rejects(selectionNavApp(configuration), message))
  }

  const queryCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'queries without a data source',
      queryApp('query Missing = Missing with { }'),
      dataValidationMessages.querySource,
    ],
    [
      'queries after unconditional control flow',
      queryApp(
        'guard "stop" empty -> { Text("Stopped") } query Workspaces = Workspaces with { }',
        'data Workspaces / Workspace { Name text }',
      ),
      dataValidationMessages.queryAfterControl,
    ],
  ]

  for (const [name, source, message] of queryCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }

  Test(
    'accepts a query limit beside ordering',
    accepts(queryApp(
      'query Workspaces = Workspaces with { order by Name limit 20 }',
      'data Workspaces / Workspace { Name text }',
    )),
  )

  Test(
    'rejects duplicate query limits',
    rejects(
      queryApp(
        'query Workspaces = Workspaces with { limit 20 limit 10 }',
        'data Workspaces / Workspace { Name text }',
      ),
      dataValidationMessages.duplicateLimit,
    ),
  )

  Test(
    'rejects a query limit below one',
    rejects(
      queryApp(
        'query Workspaces = Workspaces with { limit 0 }',
        'data Workspaces / Workspace { Name text }',
      ),
      dataValidationMessages.limitCount,
    ),
  )

  Test(
    'accepts a query search term beside ordering',
    accepts(queryApp(
      'query Documents = Documents with { search "bread" order by Title }',
      'data Documents / Document { Title text (search) }',
    )),
  )

  Test(
    'rejects duplicate query search clauses',
    rejects(
      queryApp(
        'query Documents = Documents with { search "a" search "b" }',
        'data Documents / Document { Title text (search) }',
      ),
      dataValidationMessages.duplicateSearch,
    ),
  )

  Test(
    'rejects a query search term that is not text',
    rejects(
      queryApp(
        'query Documents = Documents with { search 5 }',
        'data Documents / Document { Title text (search) }',
      ),
      dataValidationMessages.searchTermType('number'),
    ),
  )

  Test(
    'rejects a query search over an entity with no (search) field',
    rejects(
      queryApp(
        'query Documents = Documents with { search "a" }',
        'data Documents / Document { Title text }',
      ),
      dataValidationMessages.missingSearchField('Document'),
    ),
  )

  Test('reports exactly one tailored diagnostic for a module-level query', async () => {
    const result = await testValidateCodeWithErrors(`
      data Workspaces / Workspace { Name text }
      query Current = Missing with { limit 0 limit 1 }
    `)

    Expect(validationErrorMessages(result)).toEqual([dataValidationMessages.moduleQuery])
  })

  Test(
    'rejects a query nested inside a control-flow block',
    rejects(
      queryApp(
        'when "on" { empty -> { Text("Off") } otherwise -> { query Workspaces = Workspaces with { } Text("On") } }',
        'data Workspaces / Workspace { Name text }',
      ),
      dataValidationMessages.currentQueryPlacement,
    ),
  )

  const dataFieldCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'boolean cases that collide with field names',
      'data Parents / Parent { Name text, Enabled yes / Name no }',
      dataValidationMessages.duplicateBooleanCase('Parent', 'Name'),
    ],
    [
      'boolean defaults that do not name a case',
      'data Parents / Parent { Enabled yes / Disabled no (default true) }',
      dataValidationMessages.booleanDefaultCase('Enabled'),
    ],
    [
      'owned on a primitive or boolean field',
      'data Parents / Parent { Enabled yes / Disabled no (owned) }',
      dataValidationMessages.autoDeleteOwner('Enabled'),
    ],
    [
      'a field that is both optional and defaulted',
      'data Parents / Parent { Title text? (default "x") }',
      dataValidationMessages.optionalDefault('Title'),
    ],
    [
      'ambiguous owner-side cascade relations',
      `
        data Parents / Parent { Children (owned) }
        data Children / Child { Parent, OtherParent Parent }
      `,
      dataValidationMessages.ambiguousInverseRelation('Parent.Children', 'Child'),
    ],
  ]

  for (const [name, source, message] of dataFieldCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }

  Test(
    'accepts unique on a primitive field',
    accepts('data Parents / Parent { ExternalId number (unique), Name text }'),
  )

  Test(
    'accepts unique on a boolean field with named cases',
    accepts('data Parents / Parent { Enabled yes / Disabled no (unique) }'),
  )

  Test(
    'rejects unique on a non-primitive field',
    rejects(
      'data Accounts / Account { Name text } data Parents / Parent { Owner Account (unique) }',
      dataValidationMessages.uniqueFieldKind('Owner'),
    ),
  )

  Test(
    'rejects duplicate unique modifiers',
    rejects(
      'data Parents / Parent { ExternalId number (unique, unique) }',
      dataValidationMessages.duplicateModifier('ExternalId', 'unique'),
    ),
  )

  Test(
    'rejects a second unique field on one entity',
    rejects(
      'data Parents / Parent { ExternalId number (unique), Slug text (unique) }',
      dataValidationMessages.duplicateUniqueField('Parent'),
    ),
  )

  Test(
    'accepts title on a text field',
    accepts('data Recipes / Recipe { Title text (title), Servings number }'),
  )

  Test(
    'rejects title on a non-text field',
    rejects(
      'data Recipes / Recipe { Servings number (title) }',
      dataValidationMessages.titleFieldKind('Servings'),
    ),
  )

  Test(
    'rejects duplicate title modifiers',
    rejects(
      'data Recipes / Recipe { Title text (title, title) }',
      dataValidationMessages.duplicateModifier('Title', 'title'),
    ),
  )

  Test(
    'rejects a misspelled word trait',
    rejects(
      'data Recipes / Recipe { Title text (titel) }',
      dataValidationMessages.unknownTrait('titel'),
    ),
  )

  Test(
    'rejects a second title field on one entity',
    rejects(
      'data Recipes / Recipe { Title text (title), Subtitle text (title) }',
      dataValidationMessages.duplicateTitleField('Recipe'),
    ),
  )

  Test(
    'accepts search on a text field',
    accepts('data Recipes / Recipe { Title text (search), Servings number }'),
  )

  Test(
    'rejects search on a non-text field',
    rejects(
      'data Recipes / Recipe { Servings number (search) }',
      dataValidationMessages.searchFieldKind('Servings'),
    ),
  )

  Test(
    'rejects duplicate search modifiers',
    rejects(
      'data Recipes / Recipe { Title text (search, search) }',
      dataValidationMessages.duplicateModifier('Title', 'search'),
    ),
  )

  Test(
    'accepts local only beside the other entity storage facts',
    accepts('data Sessions / Session { Label text, index Label, order by Label, local only }'),
  )

  Test(
    'rejects a repeated local only storage fact',
    rejects(
      'data Sessions / Session { Label text, local only, local only }',
      dataValidationMessages.duplicateLocalOnly('Session'),
    ),
  )

  // The two storage facts partition the catalog into two stores, so a relation that spans them
  // cannot resolve. Both directions are reported where the relation is written.
  Test(
    'rejects a stored relation from a local only entity to a synced one',
    rejects(
      `
        data Parents / Parent { Name text }
        data Sessions / Session { Parent, local only }
      `,
      dataValidationMessages.crossStorageRelation('Session', 'Parent', 'Parent'),
    ),
  )

  Test(
    'rejects a stored relation from a synced entity to a local only one',
    rejects(
      `
        data Sessions / Session { Label text, local only }
        data Notes / Note { Session }
      `,
      dataValidationMessages.crossStorageRelation('Note', 'Session', 'Session'),
    ),
  )

  Test(
    'accepts a relation between two local only entities',
    accepts(
      `
        data Sessions / Session { Label text, Marks (owned), local only }
        data Marks / Mark { Session, local only }
      `,
    ),
  )

  const tagCases: ReadonlyArray<readonly [name: string, body: string, message: string]> = [
    [
      'tags attached to non-renderable statements',
      '#orphan let Label = "Rows" Text(Label)',
      ViewsValidator.messages.tagAttachment,
    ],
    [
      'tagged loops with multiple direct row roots',
      '#rows loop ["One"] / Row { Text(Row) Text(Row) }',
      ViewsValidator.messages.taggedLoopRoot,
    ],
    [
      'tagged loops with a conditional direct row root',
      '#rows loop ["Two"] / Row { when Row { empty -> { Text("Empty") } otherwise -> { Text(Row) } } }',
      ViewsValidator.messages.taggedLoopRoot,
    ],
  ]

  for (const [name, body, message] of tagCases) {
    Test(`rejects ${name}`, rejects(taggedLoopApp(body), message))
  }

  for (const member of ['Loading', 'Error', 'Empty'] as const) {
    Test(
      `rejects retired collection member ${member}`,
      rejects(collectionApp(`Text(Items.${member})`), typeValidationMessages.memberNotItem(member)),
    )
  }

  Test(
    'accepts stable entity IDs in collection loops',
    accepts(collectionApp('loop Items / Item { Text(Item.Id) }')),
  )

  Test(
    'accepts parameter defaults that reference preceding parameters',
    accepts(parameterDefaultsApp('First text default "first", Second text default First')),
  )

  const defaultScopeCases: ReadonlyArray<readonly [name: string, parameters: string, reference: string]> = [
    [
      'later parameters',
      'Third text default Fourth, Fourth text default "fourth"',
      'Fourth',
    ],
    ['the parameter itself', 'Self text default Self', 'Self'],
  ]

  for (const [name, parameters, reference] of defaultScopeCases) {
    Test(
      `rejects parameter defaults that reference ${name}`,
      rejects(parameterDefaultsApp(parameters), unresolvedValue(reference)),
    )
  }
})

function implementation(protocol: 'nav' | 'provider'): string {
  return `${protocol} TestImplementation from ./TestImplementation.ts`
}

function carouselApp(configuration: string): string {
  return `
    public type Carousel is nav with {
      Initial key
      Display text
      @key { Label text Content view }
      ${implementation('nav')}
    }
    view Home() { render Empty() }
    let Navigation = Carousel { ${configuration} }
    app Demo { Name "Demo" Navigator Navigation }
    ${stubView('Empty')}
  `
}

function responseApp(action: string): string {
  return `
    type ConfirmResult is one of Confirmed
    app Demo { view Editor }
    view Editor() { action Broken() { ${action} } render Empty() }
    view ConfirmClose(Title text) responds ConfirmResult { render Empty() }
    ${stubView('Empty')}
  `
}

function toastApp(statement: string): string {
  return `
    use StackNav from @tao/nav
    let Target = StackNav { Initial Home }
    app ToastApp { Name "Toast" Navigator Target }
    view Home() { action Present() { ${statement} } render Empty() }
    view Saved() { render Empty() }
    ${stubView('Empty')}
  `
}

function selectionVariantApp(variants: string, selection: string): string {
  return `
    use SelectionNav, StackNav from @tao/nav
    let MainNavigation = SelectionNav {
      Initial @workspace
      Display "tabs"
      @workspace { Label "Workspace" Content Home }
      @settings { Label "Settings" Content Settings }
    }
    app SelectionApp { Name "Selection" Navigator MainNavigation }
    ${variants}
    view Home() { action Activate() { present SelectionApp@${selection} } render Empty() }
    view Settings() { render Empty() }
    view Other() { render Empty() }
    ${stubView('Empty')}
  `
}

function selectionNavApp(configuration: string): string {
  return `
    use SelectionNav from @tao/nav
    let Navigation = SelectionNav { ${configuration} }
    app SelectionApp { Name "Selection" Navigator Navigation }
    view Home() { render Empty() }
    ${stubView('Empty')}
  `
}

function queryApp(body: string, declarations = ''): string {
  return `
    ${declarations}
    ${app(`render Col() { ${body} }`, `${stubContainer('Col')}${stubView('Text', 'Value text')}`)}
  `
}

function taggedLoopApp(body: string): string {
  return app(
    `render Col() { ${body} }`,
    `${stubContainer('Col')}${stubView('Text', 'Value text')}`,
  )
}

function collectionApp(body: string): string {
  return `
    data Items / Item { Title text }
    ${
    app(
      `query Items = Items with { } render Stack() { ${body} }`,
      `${stubContainer('Stack')}${stubView('Text', 'Value text')}`,
    )
  }
  `
}

function parameterDefaultsApp(parameters: string): string {
  return app(
    'render Empty()',
    `${stubView('Empty')}${stubView('Child', parameters)}`,
  )
}

function unresolvedValue(name: string): string {
  return `No value named '${name}' is in scope.`
}
