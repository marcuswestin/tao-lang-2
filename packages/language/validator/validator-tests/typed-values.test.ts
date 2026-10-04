import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, promptTagsApp, Test } from '@shared/test'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import {
  accepts,
  app,
  rejects,
  stubView,
  validationErrorMessages,
  withValidationParse,
} from './test-validate'

Describe('validator: typed values', () => {
  Test(
    'passes nominal typed lists through item fields and structural list parameters',
    accepts(promptTagsApp()),
  )

  Test('preserves alias ascriptions and omitted optional field types', async () => {
    await withValidationParse(
      `
        type Profile is { Name text, Subtitle text? }
        app TypedValues { view Main }
        view Main() {
          let Basic is Profile = Profile { Name: "Ada" }
          let MaybeSubtitle = Basic.Subtitle
          render Empty()
        }
        ${stubView('Empty')}
      `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
        const main = result.entry.ast.statements.find(
          statement => AST.isViewDeclaration(statement) && statement.name === 'Main',
        )
        Expect.Is(main, AST.isViewDeclaration)
        const basic = AST.blockStatementOf(main, 0)
        const maybeSubtitle = AST.blockStatementOf(main, 1)
        Expect.Is(basic, AST.isAliasDeclaration)
        Expect.Is(maybeSubtitle, AST.isAliasDeclaration)
        Expect(Type.displayName(Type.ofValueDeclaration(basic))).toBe('Profile')
        Expect(Type.displayName(Type.ofExpression(maybeSubtitle.value))).toBe('Profile.Subtitle | none')
      },
    )
  })

  Test(
    'rejects an alias value that does not satisfy its ascribed type',
    rejects(
      app('', 'let Count is text = 1'),
      AliasesValidator.messages.ascriptionType('Count', 'text', 'number'),
    ),
  )

  Test(
    'rejects nominal lists whose elements do not satisfy a structural list parameter',
    rejects(
      `
        type Counts is list of number
        let Counts = Counts [1]
        function Consume(Values list of text) returns text { return "unused" }
        app TypedLists { view Main }
        view Main() {
          let Broken = Consume(Values: Counts)
          render Empty()
        }
        ${stubView('Empty')}
      `,
      FunctionsValidator.messages.functionLabelType('Consume', 'Values', 'Consume.Values', 'Counts'),
    ),
  )

  Test(
    'requires optional fields to have an explicit type',
    rejects(
      app('', 'type Missing is { Label? }'),
      typeValidationMessages.optionalFieldType('Label'),
    ),
  )

  Test(
    'keeps optional fields distinct from defaulted fields',
    rejects(
      app('', 'type Defaulted is { Label text? is "fallback" }'),
      typeValidationMessages.optionalFieldDefault('Label'),
    ),
  )

  Test(
    'accepts nested list type references',
    accepts(app(
      'render Empty()',
      `function Flatten(Values list of list of text) returns list of text { return [] } ${stubView('Empty')}`,
    )),
  )

  Test(
    'enforces a declared list element type in named constructors',
    rejects(
      app('render Empty()', `type Tags is list of text let Tags = Tags [1] ${stubView('Empty')}`),
      configuredItemValidationMessages.constructorValueType('Tags', 'Tags', 'list of number'),
    ),
  )
})
