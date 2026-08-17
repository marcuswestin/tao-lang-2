import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { injectionValidationMessages } from '../validator-src/validators/injections-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import {
  accepts,
  app,
  fence,
  rejects,
  stubView,
  tsFence,
  validationErrorMessages,
  withValidationParse,
} from './test-validate'

Describe('validator: typed values', () => {
  Test(
    'passes nominal typed lists through item fields and structural list parameters',
    accepts(promptTagsApp()),
  )

  Test('accepts typed list parameters, typed injections, alias ascriptions, and omitted optional fields', async () => {
    await withValidationParse(
      `
        type Profile is { Name text, optional Subtitle text }
        app TypedValues { view Main }
        view Main() {
          let Basic is Profile = Profile { Name: "Ada" }
          let MaybeSubtitle = Basic.Subtitle
          render Empty()
        }
        function Join(Values is list of text, Separator is text) returns text {
          return inject text Values, Separator ${tsFence}
            return Values.join(Separator)
          ${fence}
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
      app('', `let Count is text = 1 ${stubView('Unused')}`),
      AliasesValidator.messages.ascriptionType('Count', 'text', 'number'),
    ),
  )

  Test(
    'rejects nominal lists whose elements do not satisfy a structural list parameter',
    rejects(
      `
        type Counts is list of number
        let Counts = Counts [1, 2]
        function Consume(Values is list of text) returns text { return "unused" }
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
      app('', 'type Missing is { optional Label }'),
      typeValidationMessages.optionalFieldType('Label'),
    ),
  )

  Test(
    'keeps optional fields distinct from defaulted fields',
    rejects(
      app('', 'type Defaulted is { optional Label text is "fallback" }'),
      typeValidationMessages.optionalFieldDefault('Label'),
    ),
  )

  Test(
    'applies duplicate argument validation to typed injections',
    rejects(
      app(
        '',
        `
          function Size(Value is text) returns number {
            return inject number Value, Value 1 ${tsFence}
              return Value.length
            ${fence}
          }
        `,
      ),
      injectionValidationMessages.duplicateArgument('Value'),
    ),
  )

  Test(
    'accepts nested list type references',
    accepts(app(
      'render Empty()',
      `function Flatten(Values is list of list of text) returns list of text { return [] } ${stubView('Empty')}`,
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

function promptTagsApp(): string {
  return `
    type PromptTitle is text
    type PromptMinutes is number
    type PromptTags is list of text
    type WritingPrompt is {
      PromptTitle,
      PromptMinutes,
      PromptTags,
    }

    let StarterTags = PromptTags ["daily", "warmup"]
    let StarterPrompt = WritingPrompt {
      PromptTitle: "Morning pages"
      PromptMinutes: 10
      StarterTags
    }

    function Join(Values is list of text, Separator is text) returns text {
      return inject text Values, Separator ${tsFence}
        return Values.join(Separator)
      ${fence}
    }

    app TypedTags { view Main }
    view Main() { render TagSummary(StarterPrompt.PromptTags) }
    view TagSummary(Tags is PromptTags) {
      let Positional = Join(Tags, Separator: ", ")
      let Labeled = Join(Values: Tags, Separator: ", ")
      render Text("{ Positional } / { Labeled }")
    }
    ${stubView('Text', 'Value is text')}
  `
}
