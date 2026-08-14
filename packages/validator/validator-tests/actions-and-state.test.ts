import { Describe, Expect, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import {
  fence,
  testValidateCode,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
} from './test-validate'

const invocationValidationMessages = InvocationsValidator.messages

Describe('Tao validator structural diagnostics', () => {
  Test('validates set, do, parameters is action, and stateful render arguments', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Button Title is text, Action is action {
        render inject Title ${tsFence}
          return null
        ${fence}
      }
      view Number Value is number {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        let DisplayCount = Count
        action AddStep Step is number {
          set Count += Step
        }
        action AddFive {
          do AddStep(5)
        }
        render Button("Add", AddFive) {
          Number(DisplayCount)
          Button("Reset", action {
            set Count = 0
          })
        }
      }
    `)
  })

  Test('allows file-level actions and forward action references inside action bodies', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      action SharedAction { }
      view Button Title is text, Action is action {
        render inject Title ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action AddTwo {
          do AddOne()
          do AddOne()
        }
        action AddOne {
          set Count += 1
        }
        render Button("Shared", SharedAction)
      }
    `)
  })

  Test('allows inline action bodies to reference later local actions', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Button Title is text, Action is action {
        render inject Title ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        let LaterClick = action {
          do AddOne()
        }
        action AddOne { }
        render Button("Add", LaterClick)
      }
    `)
  })

  Test('rejects local let initializers that reference later local actions directly', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        let LaterClick = AddOne
        action AddOne { }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('LaterClick', 'AddOne'),
    )
  })

  Test('allows local state and let initializers to reference later file-level values', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = InitialCount
        let Greeting = LateGreeting
        let Save = SharedAction
        render Text(Greeting)
      }
      let InitialCount = 1
      let LateGreeting = "Hello"
      action SharedAction { }
    `)
  })

  Test('reports action arity and action argument type mismatches', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action AddStep Step is number {
          set Count += Step
        }
        action DynamicArgs {
          do action { }(1)
        }
        action Missing {
          do AddStep()
        }
        action Extra {
          do AddStep(1, 2)
        }
        action WrongType {
          do AddStep("one")
        }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.dynamicActionArguments)
    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.missingArgument('AddStep', 'Step'))
    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.unmatchedArgument('AddStep'))
  })

  Test('reports action duplicate and ambiguous type binding diagnostics', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      type Name is Base
      type Title is Base
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action AddStep Step is number { }
        action AmbiguousScoped First is number, Second is number { }
        action AmbiguousArgument Base, Middle { }
        action AmbiguousParameter Base { }
        action CallActions {
          do AddStep(1, 2)
          do AmbiguousScoped(1)
          do AmbiguousArgument(Leaf "x")
          do AmbiguousParameter(Name "x", Title "y")
        }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.duplicateArgumentType('AddStep'))
    Expect(validationErrorMessages(result)).toContain(
      'Action AmbiguousScoped has an argument that matches multiple parameters by type: First, Second.',
    )
    Expect(validationErrorMessages(result)).toContain(
      'Action AmbiguousArgument has an argument that matches multiple parameters by type: Base, Middle.',
    )
    Expect(validationErrorMessages(result)).toContain(
      ActionsValidator.messages.ambiguousParameter('AmbiguousParameter', 'Base'),
    )
  })

  Test('validates set and member access for item-valued state', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Person is {
        Name
      }
      view MainView {
        state Current = Person { Name "Ada" }
        action Break {
          set Current = "not a person"
        }
        render Text(Current.Missing)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.setTypeMismatch('Current', 'Person', 'text'),
    )
    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.unknownMember('Person', 'Missing'))
  })

  Test('allows action arguments through unambiguous nominal lineage', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Base is text
      type Leaf is Base
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action Save Base { }
        action CallSave {
          do Save(Leaf "x")
        }
        render Text("hi")
      }
    `)
  })

  Test('allows do targets through action aliases', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      let Save = action { }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action Run {
          do Save()
        }
        render Text("hi")
      }
    `)
  })

  Test('does not report dynamic action arguments for unresolved named do targets', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action CallMissing {
          do Missing(1)
        }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).not.toContain(ActionsValidator.messages.dynamicActionArguments)
  })

  Test('reports dynamic action arguments for action-typed parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Wrapper(action { })
      }
      view Wrapper Callback is action {
        action CallCallback {
          do Callback(1)
        }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.dynamicActionArguments)
  })

  Test('validates callback signatures and positional dynamic action invocation', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
      view MainView {
        action Change Value is text { }
        action Submit { }
        render Forwarder(Change: Change, Submit: Submit)
      }
      view Forwarder Change is action(text), Submit is action() {
        render Field(Change: Change, Submit: Submit)
      }
      view Field Change is action(text), Submit is action() {
        action Relay Value is text {
          do Change(Value)
        }
        action Send {
          do Submit()
        }
        render Text("Ready")
      }
    `)
  })

  Test('rejects incompatible callback values and invalid dynamic callback calls', async () => {
    const contracts = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
      view MainView {
        action Change Value is number { }
        render Field(Change: Change, Submit: Change)
      }
      view Field Change is action(text), Submit is action() {
        render Text("Ready")
      }
    `)
    const dynamicCalls = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
      view MainView {
        action Change Value is text { }
        render Wrapper(Change)
      }
      view Wrapper Callback is action(text) {
        action Call {
          do Callback()
          do Callback(1)
          do Callback(Value: "named")
        }
        render Text("Ready")
      }
    `)

    const contractMessages = validationErrorMessages(contracts)
    Expect(contractMessages).toContain(
      invocationValidationMessages.namedArgumentType('Field', 'Change', 'action(text)', 'action(Change.Value)'),
    )
    Expect(contractMessages).toContain(
      invocationValidationMessages.namedArgumentType('Field', 'Submit', 'action()', 'action(Change.Value)'),
    )
    const dynamicMessages = validationErrorMessages(dynamicCalls)
    Expect(dynamicMessages).toContain(ActionsValidator.messages.dynamicActionArity(1, 0))
    Expect(dynamicMessages).toContain(ActionsValidator.messages.dynamicActionArgumentType(1, 'text', 'number'))
    Expect(dynamicMessages).toContain(ActionsValidator.messages.dynamicActionNamedArgument)
  })

  Test('validates computed action callbacks and honors their optional parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Message is text
      view Text Value is text { render inject ${tsFence} return null ${fence} }
      view MainView {
        action First Message { }
        action Second Message { }
        action Optional Message default "Saved" { }
        let Chosen = when true { true -> First otherwise -> Second }
        let OptionalCallback = when true { true -> Optional otherwise -> Optional }
        action Call {
          do Chosen(1)
          do OptionalCallback()
          do OptionalCallback("Saved", "extra")
        }
        render Text("Ready")
      }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(ActionsValidator.messages.dynamicActionArgumentType(1, 'Message', 'number'))
    Expect(messages).toContain(ActionsValidator.messages.dynamicActionArgumentCount(0, 1, 2))
    Expect(messages).not.toContain(ActionsValidator.messages.dynamicActionArity(1, 0))
  })

  Test('validates action callbacks reached through typed item members', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type CallbackHolder is { Callback is action(text) }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
      view MainView {
        action Receive Value is text { }
        let Holder = CallbackHolder { Receive }
        action Call { do Holder.Callback(1) }
        render Text("Ready")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      ActionsValidator.messages.dynamicActionArgumentType(1, 'text', 'number'),
    )
  })

  Test('infers a safe action type for compatible when branches regardless of order', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Message is text
      layout Stack { render inject ${tsFence} return null ${fence} }
      view MainView {
        action Short Message { }
        action Long Message, Count is number default 1 { }
        render Stack(){
          Consumer(Callback: when false { true -> Long otherwise -> Short })
          Consumer(Callback: when false { true -> Short otherwise -> Long })
        }
      }
      view Consumer Callback is action(text, number) { render inject ${tsFence} return null ${fence} }
    `)

    const messages = validationErrorMessages(result)
    const unsafeCallback = invocationValidationMessages.namedArgumentType(
      'Consumer',
      'Callback',
      'action(text, number)',
      'action(Message)',
    )
    Expect(messages.filter(message => message === unsafeCallback)).toHaveLength(2)
    Expect(messages).not.toContain('`when` branches must produce compatible value types.')
  })

  Test('does not allow an owner label to launder an incompatible action signature', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Wrapper(Callback: action { })
      }
      view Wrapper Callback is action(text) {
        render Text("Ready")
      }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    Expect(validationErrorMessages(result)).toContain(
      invocationValidationMessages.namedArgumentType('Wrapper', 'Callback', 'action(text)', 'action()'),
    )
  })

  Test('rejects action parameters that shadow visible state declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action Add Count is number {
          set Count += Count
        }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Count'))
  })

  Test('reports action arity for do invocations through action aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action AddStep Step is number {
          set Count += Step
        }
        let CallAdd = AddStep
        action Missing {
          do CallAdd()
        }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.missingArgument('AddStep', 'Step'))
  })

  Test('reports let diagnostics when cyclic action aliases are invoked', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let First = Second
      let Second = First
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action Run {
          do First()
        }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('reports invalid set value and compound set state types', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        state Name = "Ro"
        action BadSet {
          set Count = "many"
        }
        action BadCompound {
          set Name += "!"
        }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.setTypeMismatch('Count', 'number', 'text'),
    )
    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.compoundStateType('Name', '+=', 'stateful text'),
    )
  })

  Test('rejects action-valued state and mutation targets used before declaration', async () => {
    const actionState = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Click = action { }
        render Text("hi")
      }
    `)
    const lateSetTarget = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action AddOne {
          set Count += 1
        }
        state Count = 0
        render Text("hi")
      }
    `)
    const lateToggleTarget = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
      view MainView {
        action Flip {
          toggle Ready
        }
        state Ready = false
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(actionState)).toContain(StateValidator.messages.stateActionType('Click'))
    Expect(validationErrorMessages(lateSetTarget)).toContain(StateValidator.messages.usedBeforeDeclaration('Count'))
    Expect(validationErrorMessages(lateToggleTarget)).toContain(StateValidator.messages.usedBeforeDeclaration('Ready'))
  })

  Test('rejects action-valued state', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Click = action { }
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(StateValidator.messages.stateActionType('Click'))
  })

  Test('reports recursive state references without recursing forever', async () => {
    const selfReference = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = Count
        render Text("hi")
      }
    `)
    const mutualReference = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state A = B
        state B = A
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(selfReference)).toContain(StateValidator.messages.usedBeforeDeclaration('Count'))
    Expect(validationErrorMessages(mutualReference)).toContain(StateValidator.messages.usedBeforeDeclaration('B'))
  })

  Test('rejects local state initializer references to later local values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = LaterCount
        let LaterCount = 1
        render Text("hi")
      }
    `)

    Expect(validationErrorMessages(result)).toContain(StateValidator.messages.usedBeforeDeclaration('LaterCount'))
  })
})
