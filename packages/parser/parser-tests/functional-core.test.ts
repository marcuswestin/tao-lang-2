import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parseCodeWithErrors, testParseCode } from './test-parse'

Describe('parser: functional core', () => {
  Test('parses expressions, functions, total conditionals, actions, and iteration', async () => {
    const result = await testParseCode(`
      function HasCount(Count number) returns boolean {
        return Count > 0 and not false
      }
      function Label(Count number) returns text {
        return when (Count > 1) {
          true -> "Count: { Count + 1 }"
          otherwise -> "Empty"
        }
      }
      function GoalFraction(Count number) {
        if Count == 0 {
          return 0
        }
        return Count / 10
      }
      view Main() {
        state Ready = false
        action Flip() {
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
          loop ["Inbox", "Today"] / Name {
            Text(Name)
          }
        }
      }
      layout Stack() { render inject \`\`\`ts\nreturn null\n\`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const hasCount = result.entry.ast.statements.find(statement =>
      AST.isFunctionDeclaration(statement) && statement.name === 'HasCount'
    )
    Expect.Is(hasCount, AST.isFunctionDeclaration)
    const hasCountReturn = AST.returnStatementsOf(hasCount)[0]
    Expect.Is(hasCountReturn, AST.isReturnStatement)
    Expect.Is(hasCountReturn.value, AST.isBinaryExpression)
    Expect(hasCountReturn.value.operator).toBe('and')

    const goalFraction = result.entry.ast.statements.find(statement =>
      AST.isFunctionDeclaration(statement) && statement.name === 'GoalFraction'
    )
    Expect.Is(goalFraction, AST.isFunctionDeclaration)
    Expect(goalFraction.returnType).toBeUndefined()
    const earlyIf = goalFraction.block.statements[0]
    Expect.Is(earlyIf, AST.isIfFunctionStatement)
    Expect.Is(earlyIf.block.statements[0], AST.isReturnStatement)
    Expect.Is(goalFraction.block.statements[1], AST.isReturnStatement)

    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const render = AST.blockStatementOf(main, { find: AST.isRenderStatement })
    Expect.Is(render, AST.isRenderStatement)
    const controls = AST.statementsOf(render.block)
    const when = controls.find(AST.isWhenRenderStatement)
    Expect.Is(when, AST.isWhenRenderStatement)
    Expect(when.branches).toHaveLength(1)
    Expect(when.otherwise.block.statements).toHaveLength(1)
    const loop = controls.find(AST.isForStatement)
    Expect.Is(loop, AST.isForStatement)
    const loopText = loop.block.statements[0]
    Expect.Is(loopText, AST.isViewRender)
    const loopValue = AST.argumentsOf(loopText)[0]?.value
    Expect.Is(loopValue, AST.isValueReference)
    Expect(loopValue.target.ref).toBe(loop)
  })

  Test('requires otherwise in value and render subject cases while allowing single-case guards', async () => {
    const value = await parseCodeWithErrors('let Result = when true { true -> "yes" }')
    const render = await parseCodeWithErrors('view Main() { render Stack() { when true { true -> { Text("yes") } } } }')
    const action = await testParseCode('action Run() { guard true true -> { } }')

    Expect(value.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(render.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(action.entry.document.parseResult.parserErrors).toEqual([])
  })

  Test('parses declaration-linked case tests, enums, and one-sided action and render if', async () => {
    const result = await testParseCode(`
      type ConfirmResult is one of Confirmed, Cancelled
      data Documents / Document { Final yes / Draft no }
      view Main(Document) {
        state Result = Confirmed
        action Close() {
          if Result is Confirmed { }
        }
        render Stack() {
          guard Document {
            loading -> { Text("Loading") }
            missing -> { Text("Missing") }
            unauthorized -> { Text("Unauthorized") }
            error -> Message { Text(Message) }
          }
          if Result is Confirmed { Text("Confirmed") }
          if Document.Final is Draft { Text("Draft") }
        }
      }
      layout Stack() { render inject \`\`\`ts\nreturn null\n\`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const enumDeclaration = result.entry.ast.statements
      .filter(AST.isTypeDeclaration)
      .find(declaration => AST.isCaseSetTypeExpression(declaration.type))
    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(enumDeclaration, AST.isTypeDeclaration)
    Expect.Is(main, AST.isViewDeclaration)
    const close = AST.blockStatementOf(main, { find: AST.isActionDeclaration })
    const actionIf = close.block.statements.find(AST.isIfActionStatement)
    Expect.Is(actionIf, AST.isIfActionStatement)
    Expect.Is(actionIf.condition, AST.isCaseTestExpression)
    Expect(actionIf.condition.declaredCase?.ref).toBe(AST.caseSetCasesOf(enumDeclaration)[0])

    const render = AST.blockStatementOf(main, { find: AST.isRenderStatement })
    Expect.Is(render, AST.isRenderStatement)
    const availabilityGuard = AST.statementsOf(render.block).find(AST.isGuardRenderStatement)
    Expect.Is(availabilityGuard, AST.isGuardRenderStatement)
    Expect(availabilityGuard.caseBlock?.branches.map(branch => branch.case)).toEqual([
      'loading',
      'missing',
      'unauthorized',
      'error',
    ])
    const errorBranch = availabilityGuard.caseBlock?.branches.at(-1)
    Expect.Is(errorBranch, AST.isGuardRenderBranch)
    const errorText = errorBranch.block?.statements[0]
    Expect.Is(errorText, AST.isViewRender)
    const errorMessage = AST.argumentsOf(errorText)[0]?.value
    Expect.Is(errorMessage, AST.isValueReference)
    Expect(errorMessage.target.ref).toBe(errorBranch.payload)
    const renderIfs = AST.statementsOf(render.block).filter(AST.isIfRenderStatement)
    Expect(renderIfs).toHaveLength(2)
    const dataCase = renderIfs[1]?.condition
    Expect.Is(dataCase, AST.isCaseTestExpression)
    Expect(dataCase.declaredCase?.$refText).toBe('Draft')
    Expect(dataCase.declaredCase?.ref?.name).toBe('Final')

    const withElse = await parseCodeWithErrors('action Run() { if true { } else { } }')
    Expect(withElse.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
  })

  Test('parses and links scalar expressions inside interpolated strings', async () => {
    const result = await testParseCode(`
      let Name = "Ada"
      let Greeting = "Hello { Name }; next is { 1 + 2 }; choice is { when true { true -> "yes" otherwise -> "no" } }."
      let Escaped = "literal \\{ brace, \\"quote\\", and \\\\ slash"
    `)

    const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)
    const name = aliases[0]
    const greeting = aliases[1]
    const escaped = aliases[2]
    Expect.Is(name, AST.isAliasDeclaration)
    Expect.Is(greeting, AST.isAliasDeclaration)
    Expect.Is(greeting.value, AST.isInterpolatedString)
    const interpolations = greeting.value.parts.filter(AST.isStringInterpolation)
    Expect(interpolations).toHaveLength(3)
    Expect.Is(interpolations[0]?.expression, AST.isValueReference)
    Expect(interpolations[0]?.expression.target.ref).toBe(name)
    Expect.Is(interpolations[1]?.expression, AST.isBinaryExpression)
    Expect.Is(interpolations[2]?.expression, AST.isWhenExpression)
    Expect.Is(escaped, AST.isAliasDeclaration)
    Expect.Is(escaped.value, AST.isStringLiteral)
    Expect(escaped.value.value).toBe('literal { brace, "quote", and \\ slash')
  })

  Test('parses typed parameter defaults across declarations', async () => {
    const result = await testParseCode(`
      function Label(Value text default "Save") returns text { return Value }
      view Main(Title text default "Welcome") {
        action Submit(Message text default "Saved") { }
        render Card()
      }
      layout Card(Gap number default 8) { render inject \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const label = result.entry.ast.statements.find(statement => AST.isFunctionDeclaration(statement))
    const main = result.entry.ast.statements.find(statement => AST.isViewDeclaration(statement))
    const card = result.entry.ast.statements.find(statement => AST.isLayoutDeclaration(statement))
    Expect.Is(label, AST.isFunctionDeclaration)
    Expect.Is(main, AST.isViewDeclaration)
    Expect.Is(card, AST.isLayoutDeclaration)
    const submit = AST.blockStatementOf(main, { find: AST.isActionDeclaration })
    Expect.Is(submit, AST.isActionDeclaration)

    Expect(AST.parametersOf(label)[0]?.defaultValue?.$type).toBe('StringLiteral')
    Expect(AST.parametersOf(main)[0]?.defaultValue?.$type).toBe('StringLiteral')
    Expect(AST.parametersOf(submit)[0]?.defaultValue?.$type).toBe('StringLiteral')
    Expect(AST.parametersOf(card)[0]?.defaultValue?.$type).toBe('NumberLiteral')
  })

  Test('parses empty parenthesized lists on every parameterized declaration kind', async () => {
    const result = await testParseCode(`
      type Response is one of Done
      view Empty() { render inject \`\`\`ts\nreturn null\n\`\`\` }
      layout Stack() { render Empty() }
      ui Shell() { render Empty() }
      dialogue Confirm() responds Response { render Empty() }
      action Save() { }
      function Label() { return "Label" }
    `)
    const declarations = result.entry.ast.statements.filter(AST.isParameterizedDeclaration)
    Expect(declarations.map(declaration => declaration.name)).toEqual([
      'Empty',
      'Stack',
      'Shell',
      'Confirm',
      'Save',
      'Label',
    ])
    Expect(declarations.every(declaration => AST.parametersOf(declaration).length === 0)).toBe(true)
  })

  Test('requires parenthesized parameter lists on every parameterized declaration', async () => {
    const omitted = [
      'view Main { }',
      'layout Stack { }',
      'ui Shell { }',
      'type Response is one of Done dialogue Confirm responds Response { }',
      'action Save { }',
      'function Label { return "Label" }',
    ]

    for (const source of omitted) {
      const result = await parseCodeWithErrors(source)
      Expect(result.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    }
  })
})
