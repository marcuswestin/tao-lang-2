import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parseCodeWithErrors, testParseCode, testParseSyntax } from './test-parse'

Describe('parser: phrases', () => {
  Test('parses a single-form phrase, a parameterless phrase, and a plural phrase', async () => {
    const result = await testParseCode(`
      phrase WeekTitle(Day text) = "Week of { Day }"
      phrase DocumentGone = "That document is gone."
      phrase ItemCount(Count number) = one "{ Count } item" / other "{ Count } items"
      view Main() {
        render Text(WeekTitle("Monday"))
        render Text(DocumentGone)
        render Text(ItemCount(3))
      }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const phrases = result.entry.ast.statements.filter(AST.isPhraseDeclaration)
    const weekTitle = phrases.find(phrase => phrase.name === 'WeekTitle')
    const documentGone = phrases.find(phrase => phrase.name === 'DocumentGone')
    const itemCount = phrases.find(phrase => phrase.name === 'ItemCount')
    Expect.Is(weekTitle, AST.isPhraseDeclaration)
    Expect.Is(documentGone, AST.isPhraseDeclaration)
    Expect.Is(itemCount, AST.isPhraseDeclaration)

    Expect(AST.parametersOf(weekTitle)).toHaveLength(1)
    Expect.Is(weekTitle.text, AST.isInterpolatedString)
    Expect(weekTitle.forms).toHaveLength(0)

    Expect(documentGone.parameterList).toBeUndefined()
    Expect.Is(documentGone.text, AST.isStringLiteral)

    Expect(itemCount.text).toBeUndefined()
    Expect(itemCount.forms).toHaveLength(2)
    Expect(itemCount.forms.map(form => form.category)).toEqual(['one', 'other'])

    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const renders = AST.blockStatementOf(main, { filter: AST.isRenderStatement })
    const documentGoneArgument = AST.argumentsOf(renders[1]!)[0]?.value
    Expect.Is(documentGoneArgument, AST.isValueReference)
    Expect(documentGoneArgument.target.ref).toBe(documentGone)

    const itemCountArgument = AST.argumentsOf(renders[2]!)[0]?.value
    Expect.Is(itemCountArgument, AST.isFunctionCallExpression)
    Expect(itemCountArgument.function.ref).toBe(itemCount)
  })

  Test('resolves a phrase hole to its own parameter', async () => {
    const result = await testParseCode(`
      phrase ItemCount(Count number) = one "{ Count } item" / other "{ Count } items"
    `)

    const itemCount = result.entry.ast.statements.find(AST.isPhraseDeclaration)
    Expect.Is(itemCount, AST.isPhraseDeclaration)
    const parameter = AST.parametersOf(itemCount)[0]
    const otherForm = itemCount.forms.find(form => form.category === 'other')
    Expect.Is(otherForm, AST.isPhraseForm)
    Expect.Is(otherForm.text, AST.isInterpolatedString)
    const interpolation = otherForm.text.parts.find(AST.isStringInterpolation)
    Expect.Is(interpolation, AST.isStringInterpolation)
    Expect.Is(interpolation.expression, AST.isValueReference)
    Expect(interpolation.expression.target.ref).toBe(parameter)
  })

  // A parameterless phrase's zero-argument call form parses (it shares its call shape with a
  // phrase that does take arguments, per the grammar's one-call-rule design) but the validator
  // rejects it: Tao keeps one spelling per construct, so it is referenced only bare (validator test).
  Test('parses a zero-argument call for a parameterless phrase as a function call expression', async () => {
    const result = await testParseSyntax(`
      phrase DocumentGone = "That document is gone."
      view Main() {
        render Text(DocumentGone())
      }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const documentGone = result.entry.ast.statements.find(AST.isPhraseDeclaration)
    Expect.Is(documentGone, AST.isPhraseDeclaration)
    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const render = AST.blockStatementOf(main, { find: AST.isRenderStatement })
    const argument = AST.argumentsOf(render)[0]?.value
    Expect.Is(argument, AST.isFunctionCallExpression)
    Expect(argument.function.ref).toBe(documentGone)
  })

  Test('requires parentheses around a phrase parameter list when one is written', async () => {
    const result = await parseCodeWithErrors('phrase Label Count number = "{ Count }"')
    Expect(result.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
  })
})
