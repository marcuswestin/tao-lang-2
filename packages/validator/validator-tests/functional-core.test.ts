import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import {
  app,
  rejects,
  stubLayout,
  stubView,
  testValidateCode,
  testValidateCodeWithErrors,
} from './test-validate'

const runtimeViews = `${stubLayout('Stack')}${stubView('Text', 'Value is text')}`

function functionalApp(body: string, declarations = ''): string {
  return `${declarations}\n${app(body, runtimeViews)}`
}

Describe('validator: functional core', () => {
  Test(
    'rejects function results incompatible with the declared return type',
    rejects(
      functionalApp(
        'render Text("Ready")',
        'function Wrong Value is number returns boolean = Value + 1',
      ),
      FunctionalCoreValidator.messages.functionReturn('Wrong', 'boolean', 'number'),
    ),
  )

  Test(
    'rejects unsupported values in string interpolation',
    rejects(
      functionalApp(
        'render Text("Ready")',
        'function Timestamp At is time returns text = "{ At }"',
      ),
      FunctionalCoreValidator.messages.interpolationPart,
    ),
  )

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
      functionalApp('state Count = 1 action InvalidToggle { toggle Count } render Text("Ready")'),
      StateValidator.messages.toggleStateType('Count', 'number'),
    ),
  )

  Test(
    'rejects duplicate enum cases',
    rejects(
      'enum ConfirmResult { Confirmed Confirmed }',
      FunctionalCoreValidator.messages.duplicateEnumCase('ConfirmResult', 'Confirmed'),
    ),
  )

  Test(
    'rejects non-boolean action if conditions',
    rejects(
      functionalApp('action Close { if 1 { } } render Text("Ready")'),
      FunctionalCoreValidator.messages.ifCondition,
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
        'state Result = Other action Close { if Result is Confirmed { } } render Text("Ready")',
        'enum ConfirmResult { Confirmed } enum OtherResult { Other }',
      ),
      FunctionalCoreValidator.messages.invalidCase('Confirmed', 'OtherResult'),
    ),
  )

  Test(
    'rejects boolean cases from another data field',
    rejects(
      `
        data Documents / Document { Final yes / no Draft }
        data Accounts / Account { Active yes / no Inactive }
        view Main Document {
          action Close { if Document.Final is Inactive { } }
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
        data Documents / Document { Final yes / no Draft }
        view Main Document {
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
        data Documents / Document { Final yes / no Draft }
        view Main Document {
          render Stack(){ guard Document { missing -> Message { Text(Message) } } }
        }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.invalidCasePayload,
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
      'function Wrong First is text default "one", Last is text returns text = First',
      typeValidationMessages.defaultParameterOrder('Last'),
    ),
  )

  Test(
    'rejects parameter defaults with incompatible types',
    rejects(
      `${stubView('Main', 'Title is text default 1')}`,
      typeValidationMessages.defaultParameterType('Title', 'Main.Title', 'number'),
    ),
  )

  Test(
    'reports missing required function arguments',
    rejects(
      functionalApp(
        'render Text(Label())',
        'function Label Prefix is text, Value is text default "Save" returns text = "{ Prefix }{ Value }"',
      ),
      FunctionalCoreValidator.messages.functionMissingArgument('Label', 'Prefix'),
    ),
  )

  Test(
    'reports duplicate-type function arguments without positional fallback',
    rejects(
      functionalApp(
        'render Text(Label("A", "B", "C"))',
        'function Label Prefix is text, Value is text default "Save" returns text = "{ Prefix }{ Value }"',
      ),
      FunctionalCoreValidator.messages.functionDuplicateArgumentType('Label'),
    ),
  )
})
