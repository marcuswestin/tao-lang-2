import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/FunctionalCoreValidator'
import { StateValidator } from '../validator-src/StateValidator'
import { typeValidationMessages } from '../validator-src/types-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const runtimeViews = `
  layout Stack { render inject \`\`\`ts\nreturn null\n\`\`\` }
  view Text Value is text { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
`

Describe('functional core validator', () => {
  Test('accepts a typed functional path with total value, render, and action conditionals', async () => {
    await testValidateCode(`
      app FunctionalApp { view Main }
      function HasCount Count is number returns boolean = Count > 0 and not false
      function Label Count is number returns text = when (Count > 0) {
        true -> "Count: { Count }"
        otherwise -> "Empty"
      }
      view Main {
        state Ready = false
        action Flip {
          guard Ready true -> { toggle Ready }
          toggle Ready
        }
        render Stack(){
          when HasCount(2) {
            true -> {
            Text(Label(2))
            }
            otherwise -> {
            Text("Empty")
            }
          }
          loop ["Inbox", "Today"] / Name { Text(Name) }
        }
      }
      ${runtimeViews}
    `)
  })

  Test('reports actionable function, when, toggle, and collection errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app BrokenApp { view Main }
      function Wrong Value is number returns boolean = Value + 1
      function Timestamp At is time returns text = "{ At }"
      view Main {
        state Count = 1
        action InvalidToggle { toggle Count }
        render Stack(){
          when 1 {
            true -> { Text("Wrong condition") }
            otherwise -> { Text("Fallback") }
          }
          loop "not a list" / Value { Text(Value) }
        }
      }
      ${runtimeViews}
    `)
    const errors = validationErrorMessages(result)

    Expect(errors).toContain(FunctionalCoreValidator.messages.functionReturn('Wrong', 'boolean', 'number'))
    Expect(errors).toContain(FunctionalCoreValidator.messages.subjectCases)
    Expect(errors).toContain(FunctionalCoreValidator.messages.forCollection)
    Expect(errors).toContain(FunctionalCoreValidator.messages.interpolationPart)
    Expect(errors).toContain(StateValidator.messages.toggleStateType('Count', 'number'))
  })

  Test('validates enum and data case identity plus boolean one-sided if conditions', async () => {
    await testValidateCode(`
      enum ConfirmResult { Confirmed Cancelled }
      data Documents / Document { Final yes / no Draft }
      view Main Document {
        state Result = Confirmed
        action Close { if Result is Confirmed { } }
        render Stack() {
          if Result is Confirmed { Text("Confirmed") }
          if Document.Final is Draft { Text("Draft") }
        }
      }
      ${runtimeViews}
    `)

    const result = await testValidateCodeWithErrors(`
      enum ConfirmResult { Confirmed Confirmed }
      enum OtherResult { Other }
      data Documents / Document { Final yes / no Draft }
      data Accounts / Account { Active yes / no Inactive }
      view Main Document {
        state Result = Other
        action Close {
          if 1 { }
          if Result is Confirmed { }
          if Document.Final is Inactive { }
        }
        render Stack() { if "yes" { Text("Wrong") } }
      }
      ${runtimeViews}
    `)
    const errors = validationErrorMessages(result)
    Expect(errors).toContain(FunctionalCoreValidator.messages.duplicateEnumCase('ConfirmResult', 'Confirmed'))
    Expect(errors.filter(error => error === FunctionalCoreValidator.messages.ifCondition)).toHaveLength(2)
    Expect(errors).toContain(FunctionalCoreValidator.messages.invalidCase('Confirmed', 'OtherResult'))
    Expect(errors).toContain(FunctionalCoreValidator.messages.invalidCase('Inactive', 'boolean'))
  })

  Test('unifies nested list values without treating unlike element types as compatible', async () => {
    const accepted = await testValidateCode(`
      let EmptyFirst = [[], [1]]
      let EmptyLast = [[1], []]
    `)
    const emptyLists = accepted.entry.ast.statements.filter(AST.isAliasDeclaration)
    const inferredTypes = emptyLists.map(declaration => Type.ofExpression(declaration.value))
    const nestedNumberList = {
      kind: 'list',
      element: { kind: 'list', element: { kind: 'primitive', primitive: 'number' } },
    }

    Expect(inferredTypes).toEqual([nestedNumberList, nestedNumberList])

    const result = await testValidateCodeWithErrors(`
      let MixedElements = [1, 2, "one"]
      let MixedNested = [[1], [2], ["one"]]
      let MixedBranches = when true { true -> 1 false -> 2 otherwise -> "one" }
    `)
    const errors = validationErrorMessages(result)
    const listDiagnostics = result.diagnostics.filter(diagnostic =>
      diagnostic.message === FunctionalCoreValidator.messages.listElement
    )
    const branchDiagnostic = result.diagnostics.find(diagnostic =>
      diagnostic.message === FunctionalCoreValidator.messages.conditionalBranch
    )

    Expect(errors).toContain(FunctionalCoreValidator.messages.listElement)
    Expect(errors).toContain(FunctionalCoreValidator.messages.conditionalBranch)
    Expect(listDiagnostics.some(diagnostic => diagnostic.nodeType === 'StringLiteral')).toBe(true)
    Expect(branchDiagnostic?.nodeType).toBe('StringLiteral')
  })

  Test('accepts trailing typed defaults and requires named overrides for optional view parameters', async () => {
    await testValidateCode(`
      app DefaultsApp { view Main }
      function Label Prefix is text, Value is text default "Save" returns text = "{ Prefix }{ Value }"
      view Main {
        action Submit Message is text default "Saved" { }
        render Card(){
          LabelView("Plain")
          LabelView("Title", Hint: "Hint")
        }
      }
      layout Card Gap is number default 8 { render inject \`\`\`ts\nreturn null\n\`\`\` }
      view LabelView Title is text, Hint is text default "Default hint" { render inject \`\`\`ts\nreturn null\n\`\`\` }
    `)
  })

  Test('reports invalid parameter defaults and non-trailing required parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      function Wrong First is text default "one", Last is text returns text = First
      view Main Title is text default 1 { render inject \`\`\`ts\nreturn null\n\`\`\` }
    `)
    const errors = validationErrorMessages(result)

    Expect(errors).toContain(typeValidationMessages.defaultParameterOrder('Last'))
    Expect(errors).toContain(typeValidationMessages.defaultParameterType('Title', 'Main.Title', 'number'))
  })

  Test('allows functions to omit trailing defaults and bind owner labels', async () => {
    await testValidateCode(`
      app DefaultsApp { view Main }
      function Label Value is text default "Save" returns text = Value
      view Main { render Text(Label(Value: "Override")) }
      ${runtimeViews}
    `)
  })

  Test('reports missing and duplicate-type function bindings without positional fallback', async () => {
    const result = await testValidateCodeWithErrors(`
      app DefaultsApp { view Main }
      function Label Prefix is text, Value is text default "Save" returns text = "{ Prefix }{ Value }"
      view Main {
        render Col(){
          Text(Label())
          Text(Label("A", "B", "C"))
        }
      }
      ${runtimeViews}
    `)
    const errors = validationErrorMessages(result)

    Expect(errors).toContain(FunctionalCoreValidator.messages.functionMissingArgument('Label', 'Prefix'))
    Expect(errors).toContain(FunctionalCoreValidator.messages.functionDuplicateArgumentType('Label'))
  })
})
