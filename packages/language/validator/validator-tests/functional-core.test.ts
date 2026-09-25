import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import {
  accepts,
  app,
  rejects,
  rejectsFiles,
  stubContainer,
  stubView,
  testValidateCode,
  testValidateCodeWithErrors,
  validationErrorMessages,
} from './test-validate'

const runtimeViews = `${stubContainer('Stack')}${stubView('Text', 'Value text')}`

function functionalApp(body: string, declarations = ''): string {
  return `${declarations}\n${app(body, runtimeViews)}`
}

Describe('validator: functional core', () => {
  Test(
    'rejects function results incompatible with the declared return type',
    rejects(
      functionalApp(
        'render Text("Ready")',
        'function Wrong(Value number) returns boolean { return Value + 1 }',
      ),
      FunctionalCoreValidator.messages.functionReturn('Wrong', 'boolean', 'number'),
    ),
  )

  Test(
    'rejects unsupported values in string interpolation',
    rejects(
      functionalApp(
        'render Text("Ready")',
        'function Timestamp(At time) returns text { return "{ At }" }',
      ),
      FunctionalCoreValidator.messages.interpolationPart,
    ),
  )

  Test(
    'accepts optional scalar values in string interpolation',
    accepts(
      functionalApp(
        'render Text(Label(ResultValue))',
        `type Result is { Value text? }
         let ResultValue = Result { Value "Ready" }
         function Label(ResultValue Result) returns text { return "{ ResultValue.Value }" }`,
      ),
    ),
  )

  Test('does not stack an interpolation error on an unresolved optional type', async () => {
    const result = await testValidateCodeWithErrors(
      functionalApp(
        'render Text(Label(ResultValue))',
        `type Result is { Value Broken? }
         let ResultValue = Result { }
         function Label(ResultValue Result) returns text { return "{ ResultValue.Value }" }`,
      ),
    )

    Expect(validationErrorMessages(result)).not.toContain(FunctionalCoreValidator.messages.interpolationPart)
  })

  Test(
    'rejects when rendering with an unsupported subject type',
    rejects(
      functionalApp(`
        render Stack(){
          when 1 {
            true -> { Text("Wrong condition") }
            otherwise -> { Text("Fallback") }
          }
        }
      `),
      FunctionalCoreValidator.messages.subjectCases,
    ),
  )

  Test(
    'rejects loops over non-list values',
    rejects(
      functionalApp('render Stack(){ loop "not a list" / Value { Text(Value) } }'),
      FunctionalCoreValidator.messages.forCollection,
    ),
  )

  Test(
    'rejects toggle actions on non-boolean state',
    rejects(
      functionalApp('state Count = 1 action InvalidToggle() { toggle Count } render Text("Ready")'),
      StateValidator.messages.toggleStateType('Count', 'number'),
    ),
  )

  Test(
    'rejects duplicate enum cases',
    rejects(
      'type ConfirmResult is one of Confirmed, Confirmed',
      FunctionalCoreValidator.messages.duplicateEnumCase('ConfirmResult', 'Confirmed'),
    ),
  )

  Test(
    'rejects non-boolean action if conditions',
    rejects(
      functionalApp('action Close() { if 1 { } } render Text("Ready")'),
      FunctionalCoreValidator.messages.ifCondition,
    ),
  )

  Test(
    'accepts check as a top-level action statement in declared and inline actions',
    accepts(
      functionalApp(
        `
        state Name = ""
        action Add() { check Name is not empty set Name = "" }
        render Stack(){ Button() { on press -> { check Name is empty } } }
      `,
        'view Button(Press action()) { render Text("Press") }',
      ),
    ),
  )

  Test(
    'rejects non-boolean check conditions',
    rejects(
      functionalApp('state Name = "" action Add() { check Name } render Text("Ready")'),
      FunctionalCoreValidator.messages.checkCondition,
    ),
  )

  Test(
    'rejects a check nested in an if block, which would stop only that block',
    rejects(
      functionalApp('state Name = "" action Add() { if Name is empty { check Name is empty } } render Text("Ready")'),
      FunctionalCoreValidator.messages.checkPlacement,
    ),
  )

  Test(
    'rejects a check nested in a guard case, which would stop only that case',
    rejects(
      functionalApp(
        'state Name = "" action Add() { guard Name empty -> { check Name is empty } } render Text("Ready")',
      ),
      FunctionalCoreValidator.messages.checkPlacement,
    ),
  )

  Test(
    'rejects non-boolean render if conditions',
    rejects(
      functionalApp('render Stack(){ if "yes" { Text("Wrong") } }'),
      FunctionalCoreValidator.messages.ifCondition,
    ),
  )

  Test(
    'rejects enum cases from another enum',
    rejects(
      functionalApp(
        'state Result = Other action Close() { if Result is Confirmed { } } render Text("Ready")',
        'type ConfirmResult is one of Confirmed type OtherResult is one of Other',
      ),
      FunctionalCoreValidator.messages.invalidCase('Confirmed', 'OtherResult'),
    ),
  )

  Test(
    'rejects boolean cases from another data field',
    rejects(
      `
        data Documents / Document { Final yes / Draft no }
        data Accounts / Account { Active yes / Inactive no }
        view Main(Document) {
          action Close() { if Document.Final is Inactive { } }
          render Text("Ready")
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.invalidCase('Inactive', 'boolean'),
    ),
  )

  Test(
    'rejects empty guards for entity subjects',
    rejects(
      `
        data Documents / Document { Final yes / Draft no }
        view Main(Document) {
          render Stack(){ guard Document { empty -> { Text("Wrong") } } }
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.invalidCase('empty', 'an entity subject'),
    ),
  )

  Test(
    'rejects payloads on payload-free entity cases',
    rejects(
      `
        data Documents / Document { Final yes / Draft no }
        view Main(Document) {
          render Stack(){ guard Document { missing -> Message { Text(Message) } } }
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.invalidCasePayload,
    ),
  )

  Test(
    'accepts the advisory refreshing and stale cases on query subjects',
    accepts(`
      data Documents / Document { Final yes / Draft no }
      view Main() {
        query Documents { }
        render Stack(){
          guard Documents { loading -> { Text("Loading") } }
          if Documents is refreshing { Text("Refreshing") }
          when Documents { stale -> { Text("Stale") } otherwise -> { Text("Ready") } }
        }
      }
      ${runtimeViews}
    `),
  )

  Test(
    'rejects the advisory refreshing case on entity subjects',
    rejects(
      `
        data Documents / Document { Final yes / Draft no }
        view Main(Document) {
          render Stack(){ guard Document { refreshing -> { Text("Wrong") } } }
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.invalidCase('refreshing', 'an entity subject'),
    ),
  )

  Test(
    'accepts bare guards over entity and query subjects and a file-level read net',
    accepts(`
      guard default {
        loading -> Text("Opening…")
        missing -> { Text("Gone") }
        error -> Message { Text(Message) }
      }
      data Documents / Document { Title text }
      view Main(Document) {
        query Documents as Recent { }
        render Stack(){
          guard Document
          guard Recent
          Text(Document.Title)
        }
      }
      ${runtimeViews}
    `),
  )

  Test(
    'rejects a bare guard over a subject whose cases are all content',
    rejects(
      `
        view Main(Title text) {
          render Stack(){
            guard Title
            Text(Title)
          }
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.bareGuardSubject,
    ),
  )

  Test(
    'rejects an empty guard case block in favor of the bare guard',
    rejects(
      `
        data Documents / Document { Title text }
        view Main(Document) {
          render Stack(){ guard Document { } }
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.emptyGuardCases,
    ),
  )

  Test(
    'rejects read net cases that are content, repeated, or carry a message outside error',
    rejects(
      `
        guard default {
          empty -> { Text("Nothing yet") }
          rejected -> { Text("Refused") }
          loading -> { Text("One") }
          loading -> { Text("Two") }
          missing -> Message { Text(Message) }
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.guardDefaultCase('empty'),
      FunctionalCoreValidator.messages.guardDefaultCase('rejected'),
      FunctionalCoreValidator.messages.duplicateCase('loading'),
      FunctionalCoreValidator.messages.invalidCasePayload,
    ),
  )

  Test(
    'rejects a read net declared inside a view',
    rejects(
      `
        view Main() {
          render Stack(){
            guard default { loading -> { Text("Loading") } }
          }
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.guardDefaultPlacement,
    ),
  )

  Test(
    'rejects a second read net anywhere in the project',
    rejectsFiles(
      {
        'Main.tao': `
          use Other from ./Other
          guard default { loading -> { Other() } }
        `,
        'Other.tao': `
          guard default { missing -> { Other() } }
          workspace view Other() { render inject \`\`\`ts\nreturn null\n\`\`\` }
        `,
      },
      FunctionalCoreValidator.messages.guardDefaultDuplicate,
    ),
  )

  Test('unifies nested list values with an empty list on either side', async () => {
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
  })

  Test('rejects incompatible flat-list elements at the offending literal', async () => {
    const result = await testValidateCodeWithErrors('let MixedElements = [1, 2, "one"]')
    const diagnostics = result.diagnostics.filter(diagnostic =>
      diagnostic.message === FunctionalCoreValidator.messages.listElement
    )

    Expect(diagnostics).toHaveLength(1)
    Expect(diagnostics[0]?.nodeType).toBe('StringLiteral')
  })

  Test('rejects incompatible nested-list elements at the offending literal', async () => {
    const result = await testValidateCodeWithErrors('let MixedNested = [[1], [2], ["one"]]')
    const diagnostics = result.diagnostics.filter(diagnostic =>
      diagnostic.message === FunctionalCoreValidator.messages.listElement
    )

    Expect(diagnostics).toHaveLength(1)
    Expect(diagnostics[0]?.nodeType).toBe('ListLiteral')
  })

  Test('rejects incompatible when branches at the offending literal', async () => {
    const result = await testValidateCodeWithErrors(
      'let MixedBranches = when true { true -> 1 false -> 2 otherwise -> "one" }',
    )
    const diagnostic = result.diagnostics.find(diagnostic =>
      diagnostic.message === FunctionalCoreValidator.messages.conditionalBranch
    )

    Expect(diagnostic?.nodeType).toBe('StringLiteral')
  })

  Test(
    'rejects required parameters after optional parameters',
    rejects(
      'function Wrong(First text default "one", Last text) returns text { return First }',
      typeValidationMessages.defaultParameterOrder('Last'),
    ),
  )

  Test(
    'rejects parameter defaults with incompatible types',
    rejects(
      `${stubView('Main', 'Title text default 1')}`,
      typeValidationMessages.defaultParameterType('Title', 'Main.Title', 'number'),
    ),
  )

  Test(
    'reports missing required function arguments',
    rejects(
      functionalApp(
        'render Text(Label())',
        'function Label(Prefix text, Value text default "Save") returns text { return "{ Prefix }{ Value }" }',
      ),
      FunctionalCoreValidator.messages.functionMissingArgument('Label', 'Prefix'),
    ),
  )

  Test(
    'reports duplicate-type function arguments without positional fallback',
    rejects(
      functionalApp(
        'render Text(Label("A", "B", "C"))',
        'function Label(Prefix text, Value text default "Save") returns text { return "{ Prefix }{ Value }" }',
      ),
      FunctionalCoreValidator.messages.functionDuplicateArgumentType('Label'),
    ),
  )

  Test('infers one return type across early and fallthrough returns', async () => {
    const result = await testValidateCode(`
      function GoalFraction(Count number) {
        if Count == 0 { return 0 }
        return Count / 10
      }
      let Fraction = GoalFraction(5)
    `)
    const fraction = result.entry.ast.statements.find(statement =>
      AST.isAliasDeclaration(statement) && statement.name === 'Fraction'
    )
    Expect.Is(fraction, AST.isAliasDeclaration)
    Expect(Type.displayName(Type.ofExpression(fraction.value))).toBe('number')
  })

  Test(
    'rejects incompatible inferred return values',
    rejects(
      `function Mixed(Flag boolean) { if Flag { return 1 } return "none" }`,
      FunctionalCoreValidator.messages.functionReturnInference('Mixed', 'number', 'text'),
    ),
  )

  Test(
    'rejects functions without a fallthrough return',
    rejects(
      `function Partial(Flag boolean) { if Flag { return 1 } }`,
      FunctionalCoreValidator.messages.functionMissingReturn('Partial'),
    ),
  )

  Test(
    'rejects non-boolean function if conditions',
    rejects(
      `function Wrong() { if 1 { return 1 } return 2 }`,
      FunctionalCoreValidator.messages.ifCondition,
    ),
  )
})
