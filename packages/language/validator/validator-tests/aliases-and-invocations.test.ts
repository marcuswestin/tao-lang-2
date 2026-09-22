import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
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

const aliasMessages = AliasesValidator.messages
const invocationMessages = InvocationsValidator.messages
const textView = stubView('Text', 'Value text')
const stackLayout = stubContainer('Stack')

const eventViews = `
  ${stackLayout}
  ${stubView('Input', 'Value text, Change action(text), Submit action()')}
  ${stubView('BooleanInput', 'Value boolean, Change action(boolean)')}
  ${stubView('NumericInput', 'Value number, Change action(number)')}
  ${stubView('ListInput', 'Value text, Change action(list of text)')}
  ${stubView('LabelButton', 'Press text')}
`

function eventApp(child: string, setup = ''): string {
  return app(
    `
    state Draft = ""
    action Submit() { }
    action Normalize(Value text) { }
    action BooleanChange(Value boolean) { }
    action NumberChange(Value number) { }
    ${setup}
    render Stack() { ${child} }
  `,
    eventViews,
  )
}

Describe('validator: aliases and invocations', () => {
  for (
    const { title, source, messages } of [
      {
        title: 'rejects let references to later file-level values',
        source: app('render Text(Greeting)', `let Greeting = Later\nlet Later = "Hello"\n${textView}`),
        messages: [aliasMessages.aliasUsedBeforeDeclaration('Greeting', 'Later')],
      },
      {
        title: 'rejects local let references to later values',
        source: `
        app MyApp { view MainView }
        view MainView(Label text) {
          let Greeting = Later
          let Later = Label
        }
      `,
        messages: [aliasMessages.aliasUsedBeforeDeclaration('Greeting', 'Later')],
      },
      {
        title: 'rejects render arguments that reference later local aliases',
        source: app('render Stack(){ Text(Local)\nlet Local = "Hello" }', `${stackLayout}\n${textView}`),
        messages: [aliasMessages.usedBeforeDeclaration('Local')],
      },
      {
        title: 'rejects recursive let member access without recursing forever',
        source: app('', 'let A = A.X'),
        messages: [aliasMessages.aliasUsedBeforeDeclaration('A', 'A')],
      },
      {
        title: 'rejects member access on action declarations',
        source: app('render Text(Save.Label)', `action Save() { }\n${textView}`),
        messages: [typeValidationMessages.memberNotItem('Label')],
      },
      {
        title: 'rejects local aliases that shadow visible parameters',
        source: 'app MyApp { view MainView }\nview MainView(Label text) { let Label = "shadow" }',
        messages: [aliasMessages.duplicateName('Label')],
      },
      {
        title: 'rejects let self references as declaration-order violations',
        source: app('', 'let First = First'),
        messages: [aliasMessages.aliasUsedBeforeDeclaration('First', 'First')],
      },
      {
        title: 'rejects mutually recursive aliases through declaration order',
        source: app('', 'let First = Second\nlet Second = First'),
        messages: [aliasMessages.aliasUsedBeforeDeclaration('First', 'Second')],
      },
      {
        title: 'preserves declaration-order diagnostics when invalid aliases reach render arguments',
        source: app('render Text(First)', `let First = Second\nlet Second = First\n${textView}`),
        messages: [aliasMessages.aliasUsedBeforeDeclaration('First', 'Second')],
      },
    ] as const
  ) {
    Test(title, rejects(source, ...messages))
  }

  Test('attaches duplicate-alias diagnostics to the alias AST node and source range', async () => {
    const result = await testValidateCodeWithErrors(app('', 'let Greeting = "Hello"\nlet Greeting = "Again"'))
    const diagnostic = result.diagnostics.find(({ message }) => message === aliasMessages.duplicateName('Greeting'))

    Expect(validationErrorMessages(result)).toContain(aliasMessages.duplicateName('Greeting'))
    Expect(diagnostic?.nodeType).toBe(AST.AliasDeclaration.$type)
    Expect(diagnostic?.range).toBeDefined()
  })

  for (
    const [title, source, message] of [
      [
        'rejects aliases that duplicate view names',
        app('', `let Text = "Hello"\n${stubView('Text', 'Value text')}`),
        aliasMessages.duplicateName('Text'),
      ],
      [
        'rejects aliases that duplicate app names',
        app('', 'let MyApp = "Hello"'),
        aliasMessages.duplicateName('MyApp'),
      ],
      ['rejects views that duplicate app names', app('', 'view MyApp() { }'), aliasMessages.duplicateName('MyApp')],
      [
        'rejects fixtures that duplicate view names in the importable declaration namespace',
        app('', 'fixture MainView { }'),
        aliasMessages.duplicateName('MainView'),
      ],
    ] as const
  ) {
    Test(title, rejects(source, message))
  }

  Test(
    'keeps type and value names in separate namespaces',
    accepts(app('render Text(Name)', `type Name is text\nlet Name = Name "the Developer"\n${textView}`)),
  )

  Test(
    'rejects duplicate names within the type namespace',
    rejects(app('', 'type Name is text\ntype Name is number'), aliasMessages.duplicateName('Name')),
  )

  for (
    const [title, source] of [
      [
        'rejects local aliases that shadow view declarations',
        app('let Text = "Hello"\nrender Text(Text)', textView),
      ],
      [
        'rejects view parameters that shadow view declarations',
        `app MyApp { view MainView }
       view MainView(Text text) { render Text(Text) }
       ${textView}`,
      ],
    ] as const
  ) {
    Test(title, rejects(source, aliasMessages.duplicateName('Text')))
  }

  Test(
    'allows local aliases to shadow file-level aliases without hiding earlier references',
    accepts(`
      app MyApp { view MainView }
      let Greeting = "Outer"
      ${stackLayout}
      ${textView}
      view MainView() {
        let OuterGreeting = Greeting
        render Stack(){
          let Greeting = "Inner"
          Text(Greeting)
          Text(OuterGreeting)
        }
      }
    `),
  )

  for (
    const [title, source, message] of [
      [
        'requires explicit change handlers for non-state values',
        eventApp('Input(Value: ReadOnly) { on submit Submit }', 'let ReadOnly = ""'),
        invocationMessages.implicitChangeTarget('Input'),
      ],
      [
        'rejects event handlers that duplicate explicit action arguments',
        eventApp('Input(Value: Draft, Change: Normalize) { on change -> { } }'),
        invocationMessages.eventArgumentConflict('Input', 'change', 'Change'),
      ],
      [
        'rejects event actions with incompatible signatures',
        eventApp('Input(Value: Draft, Submit: Submit) { on change NumberChange }'),
        invocationMessages.eventActionType('Input', 'change', 'action(text)', 'action(NumberChange.Value)'),
      ],
      [
        'rejects duplicate event handlers',
        eventApp('Input(Value: Draft, Submit: Submit) { on change -> { } on change -> { } }'),
        invocationMessages.duplicateEvent('Input', 'change'),
      ],
      [
        'rejects payloads on events that do not provide them',
        eventApp('Input(Value: Draft) { on submit -> Payload { } }'),
        invocationMessages.unexpectedEventPayload('submit'),
      ],
      [
        'rejects change events whose payload is not one scalar',
        eventApp('ListInput(Value: Draft) { on change -> Changed { } }'),
        invocationMessages.unsupportedEvent('ListInput', 'change', 'Change'),
      ],
      [
        'rejects press events backed by non-action parameters',
        eventApp('LabelButton("Label") { on press Submit }'),
        invocationMessages.unsupportedEvent('LabelButton', 'press', 'Press'),
      ],
      [
        'rejects event handlers outside render invocations',
        eventApp('when true { true -> { on press Submit } otherwise -> { } }'),
        ViewsValidator.messages.eventPlacement,
      ],
    ] as const
  ) {
    Test(title, rejects(source, message))
  }

  Test(
    'accepts boolean change events for checkbox-style controls',
    accepts(eventApp('BooleanInput(Value: true) { on change BooleanChange }')),
  )

  Test('attaches missing-render-argument diagnostics to the render AST node', async () => {
    const message = invocationMessages.missingArgument('Tile', 'Count')
    const result = await testValidateCodeWithErrors(
      app('render Tile("Open")', stubView('Tile', 'Title text, Count number')),
    )
    const diagnostic = result.diagnostics.find(candidate => candidate.message === message)

    Expect(validationErrorMessages(result)).toContain(message)
    Expect(diagnostic?.nodeType).toBe(AST.RenderStatement.$type)
  })

  Test(
    'rejects extra render arguments',
    rejects(app('render Text("Open", 1)', textView), invocationMessages.unmatchedArgument('Text')),
  )

  Test(
    'rejects missing arguments in child view invocations',
    rejects(
      app('render Stack(){ Tile(42) }', `${stackLayout}\n${stubView('Tile', 'Title text, Count number')}`),
      invocationMessages.missingArgument('Tile', 'Title'),
    ),
  )

  Test(
    'reports both unmatched and missing arguments for positional type mismatches',
    rejects(
      app('render Tile("not a count")', stubView('Tile', 'Count number')),
      invocationMessages.unmatchedArgument('Tile'),
      invocationMessages.missingArgument('Tile', 'Count'),
    ),
  )

  Test(
    'rejects duplicate exact argument types before nominal fallback',
    rejects(
      app(
        'render Pair(Name "Ada", Name "Grace")',
        `
        type Base is text
        type Name is Base
        ${stubView('Pair', 'Base, Name')}
      `,
      ),
      invocationMessages.duplicateArgumentType('Pair'),
      invocationMessages.missingArgument('Pair', 'Base'),
    ),
  )

  Test(
    'rejects duplicate exact property types before nominal fallback',
    rejects(
      app(
        '',
        `
        type Base is text
        type Name is Base
        type Pair is {
          Base,
          Name,
        }
        let BadPair = Pair { Name "Ada", Name "Grace" }
      `,
      ),
      typeValidationMessages.duplicateProvidedPropertyType,
      typeValidationMessages.missingProperty('Base'),
    ),
  )

  Test('uses duplicate-lineage diagnostics instead of ambiguous-argument diagnostics', async () => {
    const result = await testValidateCodeWithErrors(app(
      'render Pair(Leaf "Ada", Leaf "Grace")',
      `
      type Base is text
      type Middle is Base
      type Leaf is Middle
      ${stubView('Pair', 'Base, Middle')}
    `,
    ))
    const messages = validationErrorMessages(result)

    Expect(messages).toContain(invocationMessages.duplicateArgumentType('Pair'))
    Expect(messages).toContain(invocationMessages.missingArgument('Pair', 'Base'))
    Expect(messages).toContain(invocationMessages.missingArgument('Pair', 'Middle'))
    Expect(messages.some(message => message.includes('matches multiple parameters by type'))).toBe(false)
  })

  Test('uses duplicate-lineage property diagnostics instead of ambiguous-field diagnostics', async () => {
    const result = await testValidateCodeWithErrors(app(
      '',
      `
      type Base is text
      type Middle is Base
      type Leaf is Middle
      type Pair is {
        Base,
        Middle,
      }
      let BadPair = Pair { Leaf "Ada", Leaf "Grace" }
    `,
    ))
    const messages = validationErrorMessages(result)

    Expect(messages).toContain(typeValidationMessages.duplicateProvidedPropertyType)
    Expect(messages).toContain(typeValidationMessages.missingProperty('Base'))
    Expect(messages).toContain(typeValidationMessages.missingProperty('Middle'))
    Expect(messages.some(message => message.includes('matches multiple fields by type'))).toBe(false)
  })

  Test(
    'binds same-root nominal siblings by explicit argument name',
    accepts(app(
      'render Pair(Name: "Ada", Title: "Engineer")',
      `
      type Name is text
      type Title is text
      ${stubView('Pair', 'Name, Title')}
    `,
    )),
  )

  Test(
    'rejects duplicate root literals for same-root nominal siblings',
    rejects(
      app(
        'render Pair("Ada", "Engineer")',
        `
        type Name is text
        type Title is text
        ${stubView('Pair', 'Name, Title')}
      `,
      ),
      invocationMessages.duplicateArgumentType('Pair'),
      invocationMessages.missingArgument('Pair', 'Name'),
      invocationMessages.missingArgument('Pair', 'Title'),
    ),
  )

  for (
    const [title, invocation, message] of [
      [
        'rejects unknown named arguments',
        'Field(Missing: "Draft")',
        invocationMessages.unknownNamedArgument('Field', 'Missing'),
      ],
      [
        'rejects named argument type mismatches',
        'Field(Value: 3)',
        invocationMessages.namedArgumentType('Field', 'Value', 'Field.Value', 'number'),
      ],
      [
        'rejects duplicate named arguments',
        'Field(Value: "Draft", Value: "Again")',
        invocationMessages.duplicateNamedArgument('Field', 'Value'),
      ],
    ] as const
  ) {
    Test(title, rejects(app(`render ${invocation}`, stubView('Field', 'Value text')), message))
  }

  Test(
    'does not treat visible type names as owner parameter labels',
    rejects(
      app(
        'render Card(Title: "Visible type names are not labels")',
        `type Title is text\n${stubView('Card', 'Label text')}`,
      ),
      invocationMessages.unknownNamedArgument('Card', 'Title'),
      invocationMessages.missingArgument('Card', 'Label'),
    ),
  )
})
