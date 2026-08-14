import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import {
  fence,
  testValidateCode,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
} from './test-validate'

const aliasValidationMessages = AliasesValidator.messages
const invocationValidationMessages = InvocationsValidator.messages

Describe('Tao validator structural diagnostics', () => {
  Test('rejects let references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let Greeting = Later
      let Later = "Hello"
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text(Greeting)
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  Test('rejects local let references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView Label is text {
        let Greeting = Later
        let Later = Label
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  Test('rejects local render arguments that reference later aliases', async () => {
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
          Text(Local)
          let Local = "Hello"
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.usedBeforeDeclaration('Local'))
  })

  Test('rejects recursive let member access without recursing forever', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let A = A.X
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.aliasUsedBeforeDeclaration('A', 'A'))
  })

  Test('rejects member access on action declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      action Save { }
      view MainView {
        render Text(Save.Label)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.memberNotItem('Label'))
  })

  Test('rejects duplicate file-level aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let Greeting = "Hello"
      let Greeting = "Again"
      view MainView { }
    `)
    const diagnostic = result.diagnostics.find(diagnostic =>
      diagnostic.message === AliasesValidator.messages.duplicateName('Greeting')
    )

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Greeting'))
    Expect(diagnostic?.nodeType).toBe(AST.AliasDeclaration.$type)
    Expect(diagnostic?.range).toBeDefined()
  })

  Test('rejects duplicate file-level declaration names', async () => {
    const aliasBeforeView = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let Text = "Hello"
      view MainView { }
      view Text Value is text { }
    `)
    const aliasAfterApp = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let MyApp = "Hello"
      view MainView { }
    `)
    const viewAfterApp = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MyApp { }
      view MainView { }
    `)

    Expect(validationErrorMessages(aliasBeforeView)).toContain(AliasesValidator.messages.duplicateName('Text'))
    Expect(validationErrorMessages(aliasAfterApp)).toContain(AliasesValidator.messages.duplicateName('MyApp'))
    Expect(validationErrorMessages(viewAfterApp)).toContain(AliasesValidator.messages.duplicateName('MyApp'))
  })

  Test('keeps type and value names in separate namespaces', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Name is text
      let Name = Name "Ro"
      view MainView {
        render Text(Name)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    const duplicateTypes = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Name is number
      view MainView { }
    `)

    Expect(validationErrorMessages(duplicateTypes)).toContain(aliasValidationMessages.duplicateName('Name'))
  })

  Test('rejects local aliases that shadow view declarations', async () => {
    const aliasShadow = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        let Text = "Hello"
        render Text(Text)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView Text is text {
        render Text(Text)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(aliasShadow)).toContain(AliasesValidator.messages.duplicateName('Text'))
    Expect(validationErrorMessages(parameterShadow)).toContain(AliasesValidator.messages.duplicateName('Text'))
  })

  Test('allows local aliases that shadow file-level aliases', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      let Greeting = "Outer"
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view MainView {
        let OuterGreeting = Greeting
        render Stack(){
          let Greeting = "Inner"
          Text(Greeting)
          Text(OuterGreeting)
        }
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects local aliases that shadow visible values', async () => {
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView Label is text {
        let Label = "shadow"
      }
    `)

    Expect(validationErrorMessages(parameterShadow)).toContain(AliasesValidator.messages.duplicateName('Label'))
  })

  Test('rejects let self references as undeclared-before references', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let First = First
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'First'),
    )
  })

  Test('rejects mutually recursive aliases through declaration order', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let First = Second
      let Second = First
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('returns let declaration-order diagnostics when invalid aliases are used as render arguments', async () => {
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
        render Text(First)
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('binds control events and diagnoses invalid explicit or automatic handlers', async () => {
    await testValidateCode(`
      app EventsApp { view MainView }
      layout Stack { render inject ${tsFence} return null ${fence} }
      view Input Value is text, Change is action(text), Submit is action() {
        render inject ${tsFence} return null ${fence}
      }
      view Button Press is action() { render inject ${tsFence} return null ${fence} }
      view MainView {
        state Draft = ""
        action Submit { }
        action Normalize Value is text { set Draft = Value }
        render Stack() {
          Input(Value: Draft) { on submit Submit }
          Input(Value: Draft, Submit: Submit) { on change Normalize }
          Button() { on press -> { set Draft = "pressed" } }
        }
      }
    `)

    const invalid = await testValidateCodeWithErrors(`
      app EventsApp { view MainView }
      layout Stack { render inject ${tsFence} return null ${fence} }
      view Input Value is text, Change is action(text), Submit is action() {
        render inject ${tsFence} return null ${fence}
      }
      view NumericInput Value is number, Change is action(number) {
        render inject ${tsFence} return null ${fence}
      }
      view LabelButton Press is text { render inject ${tsFence} return null ${fence} }
      view MainView {
        state Draft = ""
        let ReadOnly = ""
        action Submit { }
        action NumberChange Value is number { }
        render Stack() {
          Input(Value: ReadOnly) { on submit Submit }
          Input(Value: Draft, Change: NumberChange) {
            on change -> { }
            on submit Submit
          }
          Input(Value: Draft, Submit: Submit) { on change NumberChange }
          Input(Value: Draft, Submit: Submit) {
            on change -> { }
            on change -> { }
          }
          Input(Value: Draft) { on submit -> Payload { } }
          NumericInput(Value: 1) { on change -> Changed { } }
          LabelButton("Label") { on press Submit }
          when true {
            true -> { on press Submit }
            otherwise -> { }
          }
        }
      }
    `)
    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(invocationValidationMessages.implicitChangeTarget('Input'))
    Expect(messages).toContain(
      invocationValidationMessages.eventArgumentConflict('Input', 'change', 'Change'),
    )
    Expect(messages).toContain(
      invocationValidationMessages.eventActionType(
        'Input',
        'change',
        'action(text)',
        'action(NumberChange.Value)',
      ),
    )
    Expect(messages).toContain(invocationValidationMessages.duplicateEvent('Input', 'change'))
    Expect(messages).toContain(invocationValidationMessages.unexpectedEventPayload('submit'))
    Expect(messages).toContain(
      invocationValidationMessages.unsupportedEvent('NumericInput', 'change', 'Change'),
    )
    Expect(messages).toContain(
      invocationValidationMessages.unsupportedEvent('LabelButton', 'press', 'Press'),
    )
    Expect(messages).toContain(ViewsValidator.messages.eventPlacement)
  })

  Test('rejects render invocation arity errors', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Tile("Open")
      }
      view Tile Title is text, Count is number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text("Open", 1)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(missing)).toContain(InvocationsValidator.messages.missingArgument('Tile', 'Count'))
    Expect(
      missing.diagnostics.find(diagnostic =>
        diagnostic.message === InvocationsValidator.messages.missingArgument('Tile', 'Count')
      )?.nodeType,
    ).toBe(AST.RenderStatement.$type)
    Expect(validationErrorMessages(extra)).toContain(invocationValidationMessages.unmatchedArgument('Text'))
  })

  Test('rejects child view invocation arity and type errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view MainView {
        render Stack(){
          Tile(42)
        }
      }
      view Tile Title is text, Count is number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.missingArgument('Tile', 'Title'))
  })

  Test('rejects text and number argument mismatches by type', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Tile("not a count")
      }
      view Tile Count is number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.unmatchedArgument('Tile'))
    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.missingArgument('Tile', 'Count'))
  })

  Test('validates custom type declarations, constructors, casts, member access, and type-based binding', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Name is text
      type Age is number
      type Tags is list
      type Job is {
        Title is text
        Level is number
      }
      type Person is {
        Name
        Age
        Tags
        Job
      }
      type InlineJob is {
        Role is text
        Rank is number
      }
      type CurrentJob is InlineJob
      let DisplayName = Name "Ada"
      let DemoPerson = Person {
        Tags: Tags ["types"],
        Job: Job { Level: 2, Title: "Compiler engineer" },
        Age: 40,
        Name: DisplayName
      }
      let DemoCurrentJob = CurrentJob { Role: "Architect", Rank: 3 }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view MainView {
        render Stack(){
          Profile(DemoPerson)
          Summary(Count: 2, "People")
        }
      }
      type Count is number
      view Profile Person {
        render Stack(){
          TextValue(Person.Name)
          TextValue(Person.Job.Title)
        }
      }
      view Summary Label is text, Count {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view TextValue Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects duplicate provided exact types before nominal lineage fallback', async () => {
    const duplicateArguments = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Name is Base
      view MainView {
        render Pair(Name "Ada", Name "Grace")
      }
      view Pair Base, Name {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const duplicateProperties = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Name is Base
      type Pair is {
        Base
        Name
      }
      let BadPair = Pair { Name "Ada", Name "Grace" }
      view MainView { }
    `)
    const duplicateLineageArguments = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      view MainView {
        render Pair(Leaf "Ada", Leaf "Grace")
      }
      view Pair Base, Middle {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const duplicateLineageProperties = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      type Pair is {
        Base
        Middle
      }
      let BadPair = Pair { Leaf "Ada", Leaf "Grace" }
      view MainView { }
    `)

    Expect(validationErrorMessages(duplicateArguments)).toContain(
      invocationValidationMessages.duplicateArgumentType('Pair'),
    )
    Expect(validationErrorMessages(duplicateArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Base'),
    )
    Expect(validationErrorMessages(duplicateProperties)).toContain(typeValidationMessages.duplicateProvidedPropertyType)
    Expect(validationErrorMessages(duplicateProperties)).toContain(typeValidationMessages.missingProperty('Base'))
    Expect(validationErrorMessages(duplicateLineageArguments)).toContain(
      invocationValidationMessages.duplicateArgumentType('Pair'),
    )
    Expect(validationErrorMessages(duplicateLineageArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Base'),
    )
    Expect(validationErrorMessages(duplicateLineageArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Middle'),
    )
    Expect(
      validationErrorMessages(duplicateLineageArguments).some(message =>
        message.includes('matches multiple parameters by type')
      ),
    ).toBe(false)
    Expect(validationErrorMessages(duplicateLineageProperties)).toContain(
      typeValidationMessages.duplicateProvidedPropertyType,
    )
    Expect(validationErrorMessages(duplicateLineageProperties)).toContain(
      typeValidationMessages.missingProperty('Base'),
    )
    Expect(validationErrorMessages(duplicateLineageProperties)).toContain(
      typeValidationMessages.missingProperty('Middle'),
    )
    Expect(
      validationErrorMessages(duplicateLineageProperties).some(message =>
        message.includes('matches multiple fields by type')
      ),
    ).toBe(false)
  })

  Test('binds same-root nominal siblings while rejecting duplicate root literals', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Name is text
      type Title is text
      view MainView {
        render Pair(Name: "Ada", Title: "Engineer")
      }
      view Pair Name, Title {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    const duplicateRootArguments = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Title is text
      view MainView {
        render Pair("Ada", "Engineer")
      }
      view Pair Name, Title {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(duplicateRootArguments)).toContain(
      invocationValidationMessages.duplicateArgumentType('Pair'),
    )
    Expect(validationErrorMessages(duplicateRootArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Name'),
    )
    Expect(validationErrorMessages(duplicateRootArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Title'),
    )
  })

  Test('binds duplicate primitive parameter types by explicit argument name', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view MainView {
        action Change Value is text { }
        action Submit { }
        render Field(Value: "Draft", Change: Change, Submit: Submit, Label: "Title", Disabled: false)
      }
      view Field Value is text, Change is action(text), Submit is action(), Label is text, Disabled is boolean {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    const invalid = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Field(Missing: "Draft", Value: 3, Value: "Again")
      }
      view Field Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const messages = validationErrorMessages(invalid)
    Expect(messages).toContain(invocationValidationMessages.unknownNamedArgument('Field', 'Missing'))
    Expect(messages).toContain(
      invocationValidationMessages.namedArgumentType('Field', 'Value', 'Field.Value', 'number'),
    )
    Expect(messages).toContain(invocationValidationMessages.duplicateNamedArgument('Field', 'Value'))
  })

  Test('resolves owner labels without treating visible type names as parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Title is text
      view MainView {
        render Card(Title: "Visible type names are not labels")
      }
      view Card Label is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(invocationValidationMessages.unknownNamedArgument('Card', 'Title'))
    Expect(messages).toContain(invocationValidationMessages.missingArgument('Card', 'Label'))
  })
})
