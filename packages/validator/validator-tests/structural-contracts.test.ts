import { Describe, Expect, Test } from '@shared/test'
import { completenessValidationMessages } from '../validator-src/validators/completeness-validator'
import { configurationValidationMessages } from '../validator-src/validators/configuration-validator'
import { configuredValueValidationMessages } from '../validator-src/validators/configured-values-validator'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { DialogueValidator } from '../validator-src/validators/dialogue-validator'
import { navigationValidationMessages } from '../validator-src/validators/navigation-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import {
  accepts,
  app,
  fence,
  rejects,
  stubLayout,
  stubView,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
} from './test-validate'

Describe('validator: declaration contracts', () => {
  Test(
    'infers bare app slot blocks from the slot name and primitive role',
    accepts(`
      public nav Navigator {
        Initial ui
        ${implementation('nav', 'return TR.NavKind.Stack()')}
      }
      public datasource Datasource {
        StorageKey text
        ${implementation('provider', 'return TR.DataProvider.Local()')}
      }
      app Demo {
        Name "Demo"
        Navigator { Initial Home }
        Datasource { StorageKey "demo" }
      }
      ui Home { render Empty() }
      ${stubView('Empty')}
    `),
  )

  Test(
    'rejects a bare app slot block without its uniquely named declaration',
    rejects(
      `
        app Demo { Name "Demo" Navigator { Initial Home } }
        ui Home { render Empty() }
        ${stubView('Empty')}
      `,
      "App Demo Navigator bare block requires exactly one visible nav declaration named 'Navigator'.",
    ),
  )

  Test(
    'rejects incomplete declarations used as values',
    rejects(
      `
        use StackNav from @tao/nav
        app Demo { Name "Demo" Navigator StackNav { Initial Detail } }
        ui Detail Label is text { render Empty() }
        ${stubView('Empty')}
      `,
      completenessValidationMessages.incomplete('Detail', ['Label']),
    ),
  )

  Test(
    'requires direct app configurations to fill their supplied slots',
    rejects(
      `
        use StackNav from @tao/nav
        app Demo { Name "Demo" Navigator StackNav }
      `,
      configuredValueValidationMessages.missingConfiguration('StackNav', 'Initial'),
    ),
  )

  Test(
    'accepts arbitrary self-hosted declaration contracts without shipped-name tables',
    accepts(`
      public type Presentable is ui | nav
      public nav Carousel {
        Initial key
        Display text
        @key {
          Label text
          Content Presentable
        }
        ${implementation('nav', 'return TR.NavKind.Selection()')}
      }
      public datasource SnapshotStore {
        StorageKey text
        ${implementation('provider', 'return TR.DataProvider.Local()')}
      }
      ui Home { render Empty() }
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
      navigationValidationMessages.configurationType('Content', 'ui | nav', 'text'),
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
      ui Home { render Empty() }
      ui Other { render Empty() }
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
      ui Home { render Empty() }
      ${stubView('Empty')}
    `,
      navigationValidationMessages.patchTarget('Plain'),
    ),
  )

  const declarationCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'non-public navigation declarations',
      `nav HiddenNav { ${implementation('nav')} }`,
      configurationValidationMessages.visible('Nav'),
    ],
    [
      'duplicate ordinary declaration properties',
      `public nav Duplicate { Initial key Initial text ${implementation('nav')} }`,
      configurationValidationMessages.duplicateProperty('Initial'),
    ],
    [
      'duplicate keyed item properties',
      `public nav Duplicate { @key { Label key Label text } ${implementation('nav')} }`,
      configurationValidationMessages.duplicateProperty('Label'),
    ],
    [
      'duplicate keyed item blocks',
      `public nav Duplicate { @key { Label text } @key { Content ui } ${implementation('nav')} }`,
      configurationValidationMessages.duplicateKey,
    ],
    [
      'duplicate implementation blocks',
      `public nav Duplicate { ${implementation('provider')} ${implementation('nav')} }`,
      configurationValidationMessages.duplicateImplementation,
    ],
    [
      'navigation declarations with non-navigation implementations',
      `public nav WrongProtocol { ${implementation('provider')} }`,
      configurationValidationMessages.protocol('WrongProtocol', 'nav'),
    ],
    [
      'keyed datasource declarations',
      `public datasource KeyedStore { @key { Label text } ${implementation('provider')} }`,
      configurationValidationMessages.datasourceKey,
    ],
    [
      'datasource declarations with non-provider implementations',
      `public datasource WrongProtocol { ${implementation('nav')} }`,
      configurationValidationMessages.protocol('WrongProtocol', 'provider'),
    ],
    [
      'nested navigation declarations',
      `view Owner { public nav NestedNav { ${implementation('nav')} } render Empty() } ${stubView('Empty')}`,
      configurationValidationMessages.topLevel('Nav'),
    ],
    [
      'declarations without implementation blocks',
      'public datasource MissingImplementation { StorageKey text }',
      configurationValidationMessages.missingImplementation('MissingImplementation'),
    ],
    [
      'key-typed keyed item properties',
      `public nav KeyedProperty { @key { Label key } ${implementation('nav')} }`,
      configurationValidationMessages.keyProperty('Label'),
    ],
  ]

  for (const [name, source, message] of declarationCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }

  const dialogueCases: ReadonlyArray<readonly [name: string, action: string, message: string]> = [
    [
      'asks with missing arguments',
      'let Result = ask ConfirmClose()',
      DialogueValidator.messages.missingArgument('ConfirmClose', 'Title'),
    ],
    [
      'duplicate ask result bindings',
      'let Result = ask ConfirmClose("Draft") let Result = ask ConfirmClose("Again")',
      DialogueValidator.messages.duplicateResult('Result'),
    ],
    ['responses outside dialogues', 'respond', DialogueValidator.messages.responseContext],
  ]

  for (const [name, action, message] of dialogueCases) {
    Test(`rejects ${name}`, rejects(dialogueApp(action), message))
  }

  Test(
    'rejects overlay targets that are not navigation values',
    rejects(
      `
      use StackNav from @tao/nav
      app OverlayApp { Name "Overlay" Navigator StackNav { Initial Home } }
      ui Home {
        action Open { present Detail() as overlay in Detail }
        render Empty()
      }
      ui Detail { render Empty() }
      ${stubView('Empty')}
    `,
      navigationValidationMessages.presentationTarget('ui'),
    ),
  )

  const toastCases: ReadonlyArray<readonly [name: string, statement: string, message: string]> = [
    [
      'non-text toast keys',
      'present Saved() as toast (Key: 3, Duration: 1)',
      navigationValidationMessages.toastKeyType('number'),
    ],
    [
      'non-number toast durations',
      'present Saved() as toast (Key: "saved", Duration: "soon")',
      navigationValidationMessages.toastDurationType('text'),
    ],
    [
      'negative toast durations',
      'present Saved() as toast (Key: "saved", Duration: -1)',
      navigationValidationMessages.toastDurationNegative,
    ],
    [
      'explicit toast targets',
      'present Saved() as toast (Key: "saved", Duration: 1) in Target',
      navigationValidationMessages.toastTarget,
    ],
  ]

  for (const [name, statement, message] of toastCases) {
    Test(`rejects ${name}`, rejects(toastApp(statement), message))
  }

  Test(
    'rejects target-only selection activation outside ui actions',
    rejects(
      `
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
      ${stubView('Empty')}
    `,
      navigationValidationMessages.activationContext,
    ),
  )

  Test(
    'rejects replacement outside visual declaration actions',
    rejects(
      `
      use StackNav from @tao/nav
      let SignedOutNav = StackNav { Initial SignedOut }
      app ReplaceApp { Name "Replace" Navigator StackNav { Initial Home } }
      action Reset { replace SignedOutNav in ReplaceApp }
      ui Home { render Empty() }
      ui SignedOut { render Empty() }
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

  Test('reports every strict target that names an app variant', async () => {
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
      ${stubView('Empty')}
    `)

    const message = navigationValidationMessages.strictTargetDeclaration('StrictVariant')
    Expect(validationErrorMessages(invalid).filter(candidate => candidate === message)).toHaveLength(3)
  })

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
      navigationValidationMessages.configurationType('Content', 'ui | nav', 'text'),
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
      queryApp('query Missing { }'),
      dataValidationMessages.querySource,
    ],
    [
      'queries after unconditional control flow',
      queryApp(
        'guard "stop" empty -> { Text("Stopped") } query Workspaces { }',
        'data Workspaces / Workspace { Name text }',
      ),
      dataValidationMessages.queryAfterControl,
    ],
  ]

  for (const [name, source, message] of queryCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }

  const dataFieldCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'boolean cases that collide with field names',
      'data Parents / Parent { Name text Enabled yes / no Name }',
      dataValidationMessages.duplicateBooleanCase('Parent', 'Name'),
    ],
    [
      'boolean defaults that do not name a case',
      'data Parents / Parent { Enabled yes / no Disabled (default true) }',
      dataValidationMessages.booleanDefaultCase('Enabled'),
    ],
    [
      'relation modifiers on non-relation fields',
      'data Parents / Parent { Enabled yes / no Disabled (relation Parents) }',
      dataValidationMessages.relationModifier('Enabled'),
    ],
    [
      'auto-delete on owner-side singular relations',
      'data Parents / Parent { Child (auto-delete) } data Children / Child { Parent }',
      dataValidationMessages.autoDeleteOwner('Child'),
    ],
    [
      'ambiguous owner-side cascade relations',
      `
        data Parents / Parent { Children (auto-delete) }
        data Children / Child { Parent OtherParent (relation Parent) }
      `,
      dataValidationMessages.ambiguousInverseRelation('Parent.Children', 'Child'),
    ],
  ]

  for (const [name, source, message] of dataFieldCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }

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
    accepts(parameterDefaultsApp('First is text default "first", Second is text default First')),
  )

  const defaultScopeCases: ReadonlyArray<readonly [name: string, parameters: string, reference: string]> = [
    [
      'later parameters',
      'Third is text default Fourth, Fourth is text default "fourth"',
      'Fourth',
    ],
    ['the parameter itself', 'Self is text default Self', 'Self'],
  ]

  for (const [name, parameters, reference] of defaultScopeCases) {
    Test(
      `rejects parameter defaults that reference ${name}`,
      rejects(parameterDefaultsApp(parameters), unresolvedValue(reference)),
    )
  }
})

function implementation(protocol: 'nav' | 'provider', body = 'return null'): string {
  return `implement inject ${protocol} ${tsFence} ${body} ${fence}`
}

function carouselApp(configuration: string): string {
  return `
    public type Presentable is ui | nav
    public nav Carousel {
      Initial key
      Display text
      @key { Label text Content Presentable }
      ${implementation('nav')}
    }
    ui Home { render Empty() }
    let Navigation = Carousel { ${configuration} }
    app Demo { Name "Demo" Navigator Navigation }
    ${stubView('Empty')}
  `
}

function dialogueApp(action: string): string {
  return `
    enum ConfirmResult { Confirmed }
    app Demo { view Editor }
    view Editor { action Broken { ${action} } render Empty() }
    dialogue ConfirmClose Title is text responds ConfirmResult { render Empty() }
    ${stubView('Empty')}
  `
}

function toastApp(statement: string): string {
  return `
    use StackNav from @tao/nav
    let Target = StackNav { Initial Home }
    app ToastApp { Name "Toast" Navigator Target }
    ui Home { action Present { ${statement} } render Empty() }
    ui Saved { render Empty() }
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
    ui Home { action Activate { present SelectionApp@${selection} } render Empty() }
    ui Settings { render Empty() }
    ui Other { render Empty() }
    ${stubView('Empty')}
  `
}

function selectionNavApp(configuration: string): string {
  return `
    use SelectionNav from @tao/nav
    let Navigation = SelectionNav { ${configuration} }
    app SelectionApp { Name "Selection" Navigator Navigation }
    ui Home { render Empty() }
    ${stubView('Empty')}
  `
}

function queryApp(body: string, declarations = ''): string {
  return `
    ${declarations}
    ${app(`render Col() { ${body} }`, `${stubLayout('Col')}${stubView('Text', 'Value is text')}`)}
  `
}

function taggedLoopApp(body: string): string {
  return app(
    `render Col() { ${body} }`,
    `${stubLayout('Col')}${stubView('Text', 'Value is text')}`,
  )
}

function collectionApp(body: string): string {
  return `
    data Items / Item { Title text }
    ${
    app(
      `query Items { } render Stack() { ${body} }`,
      `${stubLayout('Stack')}${stubView('Text', 'Value is text')}`,
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
  return `Could not resolve reference to ValueDeclaration named '${name}'.`
}
