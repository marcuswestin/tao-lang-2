import { Describe, Expect, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { ReactiveParametersValidator } from '../validator-src/validators/ReactiveParametersValidator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import {
  accepts,
  app,
  rejects,
  stubContainer,
  stubView,
  testValidateCodeWithErrors,
  validationErrorMessages,
} from './test-validate'

const invocationMessages = InvocationsValidator.messages
const reactiveParameterMessages = ReactiveParametersValidator.messages
const textView = stubView('Text', 'Value text')
const stackLayout = stubContainer('Stack')

function actionApp(body: string, extra = ''): string {
  return app(`${body}\nrender Text("Ready")`, `${textView}\n${extra}`)
}

Describe('validator: actions and state', () => {
  Test(
    'rejects a computed argument for a view parameter inferred writable',
    rejects(
      app(
        'let Draft = "draft"\nrender Editor(Draft)',
        `workspace ${textView}\nview Editor(Value text) { action Save() { set Value = "saved" } render Text(Value) }`,
      ),
      reactiveParameterMessages.readonlyArgument('Value'),
    ),
  )

  Test(
    'allows a writable parameter inferred from a direct mutation',
    accepts(
      app(
        'state Draft = "draft"\nrender Editor(Draft)',
        `workspace ${textView}\nview Editor(Value text) { action Save() { set Value = "saved" } render Text(Value) }`,
      ),
    ),
  )

  Test(
    'propagates writable storage through a presented view',
    accepts(
      app(
        'render Parent("draft")',
        `workspace ${textView}
         view Parent(Value text) { action OpenEditor() { present Editor(Value) } render Text(Value) }
         view Editor(Value text) { action Save() { set Value = "saved" } render Text(Value) }`,
      ),
    ),
  )

  Test(
    'allows a literal view argument to own its inferred writable storage',
    accepts(
      app(
        'render Editor("draft")',
        `workspace ${textView}\nview Editor(Value text) { action Save() { set Value = "saved" } render Text(Value) }`,
      ),
    ),
  )

  Test(
    'allows a literal default for an inferred-writable view parameter',
    accepts(app(
      'render Editor()',
      `workspace ${textView}\nview Editor(Value text default "draft") { action Save() { set Value += "!" } render Text(Value) }`,
    )),
  )

  Test(
    'rejects a literal default for an inferred-writable action parameter',
    rejects(
      app('action Edit(Value text default "draft") { set Value += "!" }\nrender Text("ready")', textView),
      reactiveParameterMessages.readonlyArgument('Value'),
    ),
  )

  Test(
    'rejects a computed default for an inferred-writable action parameter',
    rejects(
      app(
        'let Draft = "draft"\naction Edit(Value text default Draft) { set Value += "!" }\nrender Text("ready")',
        textView,
      ),
      reactiveParameterMessages.readonlyArgument('Value'),
    ),
  )

  Test(
    'allows writable state as an inferred-writable action default',
    accepts(app(
      'state Draft = "draft"\naction Edit(Value text default Draft) { set Value += "!" }\nrender Text("ready")',
      textView,
    )),
  )

  Test(
    'allows a copied action parameter to own its literal default',
    accepts(app(
      'action Edit(copy Value text default "draft") { set Value += "!" }\nrender Text("ready")',
      textView,
    )),
  )

  Test(
    'propagates writable requirements through a nested action default',
    rejects(
      app(
        'let Draft = "draft"\nrender Editor(Draft)',
        `workspace ${textView}
         view Editor(Value text) {
           action Edit(Local text default Value) { set Local += "!" }
           render Text(Value)
         }`,
      ),
      reactiveParameterMessages.readonlyArgument('Value'),
    ),
  )

  Test(
    'rejects an incompatible value assigned to a writable parameter',
    rejects(
      app(
        'render Editor(1)',
        `workspace ${textView}\nview Editor(Value number) { action Save() { set Value = "wrong" } render Text("ready") }`,
      ),
      StateValidator.messages.mutableSetTypeMismatch('Value', 'Editor.Value', 'text'),
    ),
  )

  Test(
    'allows mutation of a field on a writable item parameter',
    accepts(app(
      'state Draft = Note { Title "old" }\nrender Editor(Draft)',
      `workspace ${textView}
       type Note is { Title text }
       view Editor(Value Note) { action Save() { set Value.Title = "new" } render Text(Value.Title) }`,
    )),
  )

  Test(
    'terminates writable inference through recursive forwarding',
    accepts(app(
      'state Draft = "draft"\nrender First(Draft)',
      `workspace ${textView}
      view First(Value text) { action Save() { set Value = "saved" } render Second(Value) }
      view Second(Value text) { render First(Value) }
    `,
    )),
  )

  Test(
    'lets a copied parameter provide writable storage to a nested view',
    accepts(
      app(
        'state Draft = "draft"\nrender Wrapper(Draft)',
        `
        workspace ${textView}
        view Editor(Value text) { action Save() { set Value = "saved" } render Text(Value) }
        view Wrapper(copy Value text) { render Editor(Value) }
      `,
      ),
    ),
  )

  Test(
    'allows a computed input when an ordinary Change argument owns its updates',
    accepts(app(
      'let Draft = "draft"\nrender Editor(Draft)',
      `
      workspace ${stubView('TextInput', 'mutable Value text, Change action(text), Submit action()')}
      view Editor(Value text) {
        action SetTitle(Next text) { }
        action Save() { }
        render TextInput(Value: Value, Change: SetTitle, Submit: Save)
      }
    `,
    )),
  )

  Test(
    'rejects a mutating action passed to a native readonly Change callback',
    rejects(
      app(
        'action Normalize(Value text) { set Value = "normalized" }\nrender TextInput(Value: "draft", Change: Normalize, Submit: action { })',
        stubView('TextInput', 'mutable Value text, Change action(text), Submit action()'),
      ),
      invocationMessages.namedArgumentType('TextInput', 'Change', 'action(text)', 'action(writable Normalize.Value)'),
    ),
  )

  Test(
    'rejects a mutating action passed to an ordinary readonly callback',
    rejects(
      app(
        'action Normalize(Value text) { set Value = "normalized" }\nrender Wrapper(Callback: Normalize)',
        `${textView}\nview Wrapper(Callback action(text)) { render Text("ready") }`,
      ),
      invocationMessages.namedArgumentType('Wrapper', 'Callback', 'action(text)', 'action(writable Normalize.Value)'),
    ),
  )

  Test(
    'allows a copied action parameter through a readonly callback contract',
    accepts(
      app(
        'action Normalize(copy Value text) { set Value = "normalized" }\nrender Wrapper(Callback: Normalize)',
        `${textView}\nview Wrapper(Callback action(text)) { render Text("ready") }`,
      ),
    ),
  )

  Test(
    'rejects a literal passed through an alias to a mutating action',
    rejects(
      app(
        'action Mutate(Value text) { set Value = "saved" }\nlet Alias = Mutate\naction Run() { do Alias("draft") }\nrender Text("ready")',
        textView,
      ),
      reactiveParameterMessages.readonlyArgument('Value'),
    ),
  )

  Test(
    'allows writable state passed through an alias to a mutating action',
    accepts(app(
      'state Draft = "draft"\naction Mutate(Value text) { set Value = "saved" }\nlet Alias = Mutate\naction Run() { do Alias(Draft) }\nrender Text("ready")',
      textView,
    )),
  )

  Test(
    'propagates writable requirements through an aliased action call',
    rejects(
      app(
        'let Draft = "draft"\nrender Editor(Draft)',
        `workspace ${textView}
         view Editor(Value text) {
           action Mutate(Value text) { set Value = "saved" }
           let Alias = Mutate
           action Run() { do Alias(Value) }
           render Text(Value)
         }`,
      ),
      reactiveParameterMessages.readonlyArgument('Value'),
    ),
  )
  Test(
    'allows file-level actions as render arguments',
    accepts(
      app(
        'render Button("Shared", SharedAction)',
        `action SharedAction() { }\n${stubView('Button', 'Title text, Action action')}`,
      ),
    ),
  )

  Test(
    'allows forward action references inside action bodies',
    accepts(actionApp(`
      state Count = 0
      action AddTwo() {
        do AddOne()
        do AddOne()
      }
      action AddOne() { set Count += 1 }
    `)),
  )

  Test(
    'allows inline action bodies to reference later local actions',
    accepts(app(
      `
      let LaterClick = action { do AddOne() }
      action AddOne() { }
      render Button("Add", LaterClick)
    `,
      stubView('Button', 'Title text, Action action'),
    )),
  )

  for (
    const [title, body, extra] of [
      [
        'allows state initializers to reference later file-level values',
        'state Count = InitialCount',
        'let InitialCount = 1',
      ],
      [
        'allows local aliases to reference later file-level values',
        'let Greeting = LateGreeting',
        'let LateGreeting = "Hello"',
      ],
      [
        'allows local aliases to reference later file-level actions',
        'let Save = SharedAction',
        'action SharedAction() { }',
      ],
      [
        'allows compound mutation of a number state',
        'state Count = 0\naction Bump() { set Count += 1 }',
        '',
      ],
      [
        'allows compound mutation of a state declared as number',
        'state Count is number = 0\naction Bump() { set Count += 1 }',
        '',
      ],
      [
        'allows compound text concatenation',
        'state Name = "Ro"\naction Greet() { set Name += "!" }',
        '',
      ],
    ] as const
  ) {
    Test(title, accepts(actionApp(body, extra)))
  }

  Test(
    'allows action arguments through unambiguous nominal lineage',
    accepts(actionApp(
      `
      action Save(Base) { }
      action CallSave() { do Save(Leaf "x") }
    `,
      'type Base is text\ntype Leaf is Base',
    )),
  )

  for (
    const { title, body, extra = '', messages } of [
      {
        title: 'rejects local aliases that directly reference later local actions',
        body: 'let LaterClick = AddOne\naction AddOne() { }',
        messages: [AliasesValidator.messages.aliasUsedBeforeDeclaration('LaterClick', 'AddOne')],
      },
      {
        title: 'rejects arguments passed to untyped action callbacks',
        body: 'action Call() { do action { }(1) }',
        messages: [ActionsValidator.messages.dynamicActionArguments],
      },
      {
        title: 'reports a missing action argument',
        body: 'action AddStep(Step number) { }\naction Call() { do AddStep() }',
        messages: [ActionsValidator.messages.missingArgument('AddStep', 'Step')],
      },
      {
        title: 'reports an unmatched action argument',
        body: 'action AddStep(Step number) { }\naction Call() { do AddStep("one") }',
        messages: [ActionsValidator.messages.unmatchedArgument('AddStep')],
      },
      {
        title: 'reports duplicate exact action argument types',
        body: 'action AddStep(Step number) { }\naction Call() { do AddStep(1, 2) }',
        messages: [ActionsValidator.messages.duplicateArgumentType('AddStep')],
      },
      {
        title: 'reports arguments ambiguous between same-typed action parameters',
        body: 'action Save(First number, Second number) { }\naction Call() { do Save(1) }',
        messages: ['Action Save has an argument that matches multiple parameters by type: First, Second.'],
      },
      {
        title: 'reports arguments ambiguous across nominal lineage parameters',
        body: 'action Save(Base, Middle) { }\naction Call() { do Save(Leaf "x") }',
        extra: 'type Base is text\ntype Middle is Base\ntype Leaf is Middle',
        messages: ['Action Save has an argument that matches multiple parameters by type: Base, Middle.'],
      },
      {
        title: 'reports nominal action parameters matched by multiple arguments',
        body: 'action Save(Base) { }\naction Call() { do Save(Name "x", Title "y") }',
        extra: 'type Base is text\ntype Name is Base\ntype Title is Base',
        messages: [ActionsValidator.messages.ambiguousParameter('Save', 'Base')],
      },
      {
        title: 'rejects incompatible values assigned to item-valued state',
        body: 'state Current = Person { Name "Ada" }\naction Break() { set Current = "not a person" }',
        extra: 'type Name is text\ntype Person is { Name }',
        messages: [StateValidator.messages.setTypeMismatch('Current', 'Person', 'text')],
      },
      {
        title: 'rejects unknown members of item-valued state',
        body: 'state Current = Person { Name "Ada" }\nlet Missing = Current.Missing',
        extra: 'type Name is text\ntype Person is { Name }',
        messages: [typeValidationMessages.unknownMember('Person', 'Missing')],
      },
      {
        title: 'rejects action parameters that shadow visible state declarations',
        body: 'state Count = 0\naction Add(Count number) { set Count += Count }',
        messages: [AliasesValidator.messages.duplicateName('Count')],
      },
      {
        title: 'reports action arity through action aliases',
        body: 'action AddStep(Step number) { }\nlet CallAdd = AddStep\naction Missing() { do CallAdd() }',
        messages: [ActionsValidator.messages.missingArgument('AddStep', 'Step')],
      },
      {
        title: 'reports declaration-order diagnostics through cyclic action aliases',
        body: 'action Run() { do First() }',
        extra: 'let First = Second\nlet Second = First',
        messages: [AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'Second')],
      },
      {
        title: 'rejects incompatible set values',
        body: 'state Count = 0\naction BadSet() { set Count = "many" }',
        messages: [StateValidator.messages.setTypeMismatch('Count', 'number', 'text')],
      },
      {
        title: 'rejects compound mutation of non-number state',
        body: 'state Ready = false\naction BadCompound() { set Ready += true }',
        messages: [StateValidator.messages.compoundStateType('Ready', '+=', 'boolean')],
      },
      {
        title: 'checks set values against the declared state type rather than its initial value',
        body: 'state Value is Mixed = "start"\naction BadSet() { set Value = false }',
        extra: 'type Mixed is text | number',
        messages: [StateValidator.messages.setTypeMismatch('Value', 'text | number', 'boolean')],
      },
      {
        title: 'names a refined set value by its Tao type',
        body: 'state Count = 0\naction BadSet() { set Count = Label "many" }',
        extra: 'type Label is text',
        messages: [StateValidator.messages.setTypeMismatch('Count', 'number', 'Label')],
      },
      {
        title: 'names a declared list state by its element type',
        body: 'state Items is list of text = []\naction BadSet() { set Items = "one" }',
        messages: [StateValidator.messages.setTypeMismatch('Items', 'list of text', 'text')],
      },
      {
        title: 'rejects action-valued state',
        body: 'state Click = action { }',
        messages: [StateValidator.messages.stateActionType('Click')],
      },
      {
        title: 'rejects do on a non-action value',
        body: 'let Greeting = "hi"\naction Run() { do Greeting() }',
        messages: [ActionsValidator.messages.doTypeMismatch('text')],
      },
      {
        title: 'rejects set targets declared later in the same view',
        body: 'action AddOne() { set Count += 1 }\nstate Count = 0',
        messages: [StateValidator.messages.usedBeforeDeclaration('Count')],
      },
      {
        title: 'rejects toggle targets declared later in the same view',
        body: 'action Flip() { toggle Ready }\nstate Ready = false',
        messages: [StateValidator.messages.usedBeforeDeclaration('Ready')],
      },
      {
        title: 'reports self-referential state without recursing forever',
        body: 'state Count = Count',
        messages: [StateValidator.messages.usedBeforeDeclaration('Count')],
      },
      {
        title: 'reports mutually recursive state without recursing forever',
        body: 'state A = B\nstate B = A',
        messages: [StateValidator.messages.usedBeforeDeclaration('B')],
      },
      {
        title: 'rejects state initializer references to later local values',
        body: 'state Count = LaterCount\nlet LaterCount = 1',
        messages: [StateValidator.messages.usedBeforeDeclaration('LaterCount')],
      },
    ] as const
  ) {
    Test(title, rejects(actionApp(body, extra), ...messages))
  }

  Test('reports the assignment error when text concatenation has a mismatched value', async () => {
    const result = await testValidateCodeWithErrors(
      actionApp('state Name = "Ro"\naction BadCompound() { set Name += 1 }'),
    )
    Expect(validationErrorMessages(result)).toEqual([
      StateValidator.messages.setTypeMismatch('Name', 'text', 'number'),
    ])
  })

  Test('reports inferred-type diagnostics after structural diagnostics for a file', async () => {
    const result = await testValidateCodeWithErrors(
      actionApp('let Greeting = "hi"\naction Run() { do Greeting() }\naction Run() { }'),
    )
    Expect(validationErrorMessages(result)).toEqual([
      AliasesValidator.messages.duplicateName('Run'),
      ActionsValidator.messages.doTypeMismatch('text'),
    ])
  })

  Test('does not classify unresolved named do targets as dynamic actions', async () => {
    const result = await testValidateCodeWithErrors(actionApp('action CallMissing() { do Missing(1) }'))
    Expect(validationErrorMessages(result)).not.toContain(ActionsValidator.messages.dynamicActionArguments)
  })

  Test(
    'rejects arguments passed to action-typed parameters without signatures',
    rejects(
      app(
        'render Wrapper(action { })',
        `${textView}\nview Wrapper(Callback action) {
        action CallCallback() { do Callback(1) }
        render Text("Ready")
      }`,
      ),
      ActionsValidator.messages.dynamicActionArguments,
    ),
  )

  for (
    const { title, call, message } of [
      {
        title: 'reports missing positional callback arguments',
        call: 'do Callback()',
        message: ActionsValidator.messages.dynamicActionArity(1, 0),
      },
      {
        title: 'reports positional callback argument type mismatches',
        call: 'do Callback(1)',
        message: ActionsValidator.messages.dynamicActionArgumentType(1, 'text', 'number'),
      },
      {
        title: 'rejects named arguments for dynamic callbacks',
        call: 'do Callback(Value: "named")',
        message: ActionsValidator.messages.dynamicActionNamedArgument,
      },
    ] as const
  ) {
    Test(
      title,
      rejects(
        app(
          'action Change(Value text) { }\nrender Wrapper(Change)',
          `${textView}\nview Wrapper(Callback action(text)) {
          action Call() { ${call} }
          render Text("Ready")
        }`,
        ),
        message,
      ),
    )
  }

  for (
    const [title, parameter, expected, actual] of [
      ['rejects incompatible typed callbacks', 'Change', 'action(text)', 'action(Change.Value)'],
      ['rejects callbacks with too many required parameters', 'Submit', 'action()', 'action(Change.Value)'],
    ] as const
  ) {
    Test(
      title,
      rejects(
        app(
          'action Change(Value number) { }\nrender Field(Change: Change, Submit: Change)',
          `${textView}\n${stubView('Field', 'Change action(text), Submit action()')}`,
        ),
        invocationMessages.namedArgumentType('Field', parameter, expected, actual),
      ),
    )
  }

  Test('allows omitted optional computed-callback arguments while reporting other invalid calls', async () => {
    const result = await testValidateCodeWithErrors(actionApp(
      `
      action First(Message) { }
      action Second(Message) { }
      action Optional(Message default "Saved") { }
      let Chosen = when true { true -> First otherwise -> Second }
      let OptionalCallback = when true { true -> Optional otherwise -> Optional }
      action Call() {
        do Chosen(1)
        do OptionalCallback()
        do OptionalCallback("Saved", "extra")
      }
    `,
      'type Message is text',
    ))

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(ActionsValidator.messages.dynamicActionArgumentType(1, 'Message', 'number'))
    Expect(messages).toContain(ActionsValidator.messages.dynamicActionArgumentCount(0, 1, 2))
    Expect(messages).not.toContain(ActionsValidator.messages.dynamicActionArity(1, 0))
  })

  Test(
    'validates action callbacks reached through typed item members',
    rejects(
      actionApp(
        `
        action Receive(Value text) { }
        let Holder = CallbackHolder { Receive }
        action Call() { do Holder.Callback(1) }
      `,
        'type CallbackHolder is { Callback action(text) }',
      ),
      ActionsValidator.messages.dynamicActionArgumentType(1, 'text', 'number'),
    ),
  )

  Test('infers safe action types for compatible when branches regardless of order', async () => {
    const result = await testValidateCodeWithErrors(app(
      `
      action Short(Message) { }
      action Long(Message, Count number default 1) { }
      render Stack(){
        Consumer(Callback: when false { true -> Long otherwise -> Short })
        Consumer(Callback: when false { true -> Short otherwise -> Long })
      }
    `,
      `type Message is text\n${stackLayout}\n${stubView('Consumer', 'Callback action(text, number)')}`,
    ))

    const messages = validationErrorMessages(result)
    const unsafeCallback = invocationMessages.namedArgumentType(
      'Consumer',
      'Callback',
      'action(text, number)',
      'action(Message)',
    )
    Expect(messages.filter(message => message === unsafeCallback)).toHaveLength(2)
    Expect(messages).not.toContain('`when` branches must produce compatible value types.')
  })

  Test(
    'does not let owner labels launder incompatible action signatures',
    rejects(
      app(
        'render Wrapper(Callback: action { })',
        `${textView}\nview Wrapper(Callback action(text)) { render Text("Ready") }`,
      ),
      invocationMessages.namedArgumentType('Wrapper', 'Callback', 'action(text)', 'action()'),
    ),
  )
})
