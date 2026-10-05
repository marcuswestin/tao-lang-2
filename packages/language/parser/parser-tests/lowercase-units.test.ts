import { Workspace } from '@compiler/workspace'
import { AST, Parser } from '@parser'
import { Assert, Diagnostics } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { parseCodeWithErrors, rejectsParser, testLexCode, testParseCode, testParseSyntax } from './test-parse'

const duration = 'type Duration is numeric with { units { seconds 1 (default), milli_seconds2 0.001 } }'

function alias(file: AST.TaoFile, name: string): AST.AliasDeclaration {
  const declaration = file.statements.find(statement => AST.isAliasDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isAliasDeclaration)
  return declaration
}

Describe('parser: lowercase numeric units', () => {
  Test('links adjacent, spaced, signed and grouped lowercase suffixes to their declared rows', async () => {
    const result = await testParseCode(`${duration}
      let Adjacent = 2seconds
      let Qualified = 2 Duration.seconds
      let Signed = -2 milli_seconds2
      let Grouped = (1 + 2) Duration.seconds
    `)
    const constructions = ['Adjacent', 'Qualified', 'Signed', 'Grouped'].map(name =>
      alias(result.entry.ast, name).value
    )
    constructions.forEach(construction => Expect.Is(construction, AST.isNumericUnitConstruction))
    const units = constructions.filter(AST.isNumericUnitConstruction)
    Expect(units.map(construction => construction.unit.$refText)).toEqual([
      'seconds',
      'Duration.seconds',
      'milli_seconds2',
      'Duration.seconds',
    ])
    Expect(units.map(construction => construction.unit.ref?.name)).toEqual([
      'seconds',
      'seconds',
      'milli_seconds2',
      'seconds',
    ])
    Expect(units[0]!.unit.ref).toBe(units[1]!.unit.ref)
    Expect(units[0]!.unit.ref).toBe(units[3]!.unit.ref)
  })

  Test('keeps lowercase and mixed-case owner paths available before a lowercase final segment', async () => {
    await withTaoFiles('tao-lowercase-units-', {
      'Main.tao': `
        use package ./library as library
        type mixedOwner = library.Duration
        let LowerPath = 2 library.Duration.seconds
        let MixedOwner = 2 mixedOwner.seconds
      `,
      'library/Duration.tao': `public ${duration}`,
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      Expect(Diagnostics.errorMessages(result.diagnostics)).toEqual([])
      const lower = alias(result.entry.ast, 'LowerPath').value
      const mixed = alias(result.entry.ast, 'MixedOwner').value
      Expect.Is(lower, AST.isNumericUnitConstruction)
      Expect.Is(mixed, AST.isNumericUnitConstruction)
      Expect(lower.unit.$refText).toBe('library.Duration.seconds')
      Expect(mixed.unit.$refText).toBe('mixedOwner.seconds')
      Expect(lower.unit.ref?.name).toBe('seconds')
      Expect(mixed.unit.ref).toBe(lower.unit.ref)
    })
  })

  for (const name of ['Seconds', 'milliSeconds', '_Seconds', 'secondsX']) {
    Test(
      `rejects a unit declaration containing an uppercase letter: ${name}`,
      rejectsParser(`
      type Duration is numeric with { units { ${name} 1 (default) } }
    `),
    )
  }

  for (const suffix of ['Seconds', 'milliSeconds']) {
    Test(`does not construct a unit from an uppercase bare name: ${suffix}`, async () => {
      const result = await parseCodeWithErrors(`${duration}
        let Wrong = 2 ${suffix}
      `)
      Expect(result.entry.document.parseResult.lexerErrors).toEqual([])
      Expect(result.entry.document.parseResult.parserErrors).toEqual([])
      Expect.Is(alias(result.entry.ast, 'Wrong').value, AST.isNumberLiteral)
      Expect(AST.streamAllContents(result.entry.ast).filter(AST.isNumericUnitConstruction)).toEqual([])
      const reference = AST.streamAllContents(result.entry.ast).find(node =>
        AST.isViewRender(node) && node.view?.$refText === suffix
      )
      Expect.Is(reference, AST.isViewRender)
      Assert.defined(reference.view, 'the uppercase suffix fixture has a view reference')
      Expect(reference.view.ref).toBeUndefined()
      Expect(Diagnostics.errorMessages(result.diagnostics).some(message => message.includes(suffix))).toBe(true)
    })
  }

  Test('links a lowercase qualified suffix inside an argument', async () => {
    const result = await testParseCode(`${duration}
      func Take(Value Duration) fails never -> Duration { return Value }
      let Quantity = Take(2 Duration.seconds)
    `)
    const call = alias(result.entry.ast, 'Quantity').value
    Expect.Is(call, AST.isFunctionCallExpression)
    const argument = call.argumentList?.arguments[0]?.value
    Expect.Is(argument, AST.isNumericUnitConstruction)
    Expect(argument.unit.$refText).toBe('Duration.seconds')
    Expect(argument.unit.ref?.name).toBe('seconds')
  })

  for (const [suffix, member] of [['Duration.Seconds', 'Seconds'], ['Duration.secondsX', 'secondsX']]) {
    Test(
      `rejects an uppercase final suffix segment inside an argument: ${suffix}`,
      rejectsParser(`${duration}
      func Take(Value Duration) fails never -> Duration { return Value }
      let Wrong = Take(2 ${suffix})
    `),
    )

    Test(`keeps an adjacent qualified render separate from a numeric suffix: ${suffix}`, async () => {
      const result = await testParseSyntax(`${duration}
        let Number = 2 ${suffix}
      `)
      Expect.Is(alias(result.entry.ast, 'Number').value, AST.isNumberLiteral)
      Expect(AST.streamAllContents(result.entry.ast).filter(AST.isNumericUnitConstruction)).toEqual([])
      const render = result.entry.ast.statements.find(AST.isViewRender)
      Expect.Is(render, AST.isViewRender)
      Expect.Is(render.expression, AST.isMemberAccessExpression)
      Expect(render.expression.target.$refText).toBe('Duration')
      Expect(render.expression.members).toEqual([member])
    })
  }

  Test('lexes whole lowercase names and mixed-case keyword prefixes without splitting them', () => {
    const result = testLexCode('seconds _seconds milli_seconds2 stateful statefulX secondsX _Seconds state stateX')
    Expect(result.tokens.map(token => token.image)).toEqual([
      'seconds',
      '_seconds',
      'milli_seconds2',
      'stateful',
      'statefulX',
      'secondsX',
      '_Seconds',
      'state',
      'stateX',
    ])
    Expect(result.tokens.map(token => token.tokenType.name)).toEqual([
      'NUMERIC_UNIT_ID',
      'NUMERIC_UNIT_ID',
      'NUMERIC_UNIT_ID',
      'NUMERIC_UNIT_ID',
      'ID',
      'ID',
      'ID',
      'state',
      'ID',
    ])
  })

  Test('preserves lowercase value, function, field and view names through ID rules and interpolation', async () => {
    const result = await testParseCode(`
      let greeting = "hello"
      type Holder is { field text }
      let holder = Holder { field: greeting }
      function identity(payload text) returns text { return payload }
      let message = "{identity(holder.field)}"
      view leaf { render inject \`\`\`ts return null \`\`\` }
      view main { render leaf }
    `)
    const holder = alias(result.entry.ast, 'holder').value
    Expect.Is(holder, AST.isConfigurationConstructor)
    Expect(holder.block?.entries[0]?.label).toBe('field')
    const message = alias(result.entry.ast, 'message').value
    Expect.Is(message, AST.isInterpolatedString)
    const call = AST.streamAllContents(message).find(AST.isFunctionCallExpression)
    Expect.Is(call, AST.isFunctionCallExpression)
    Expect(call.function.ref?.name).toBe('identity')
    const render = AST.streamAllContents(result.entry.ast).find(node =>
      AST.isRenderStatement(node) && node.view?.$refText === 'leaf'
    )
    Expect.Is(render, AST.isRenderStatement)
    const rendered = render.view?.ref
    Expect.Is(rendered, AST.isViewDeclaration)
    Expect(rendered.name).toBe('leaf')
  })

  Test('keeps lower view and directive names outside direct label and scalar suffixes', async () => {
    const result = await testParseSyntax(`${duration}
      type Holder is { field number }
      let holder = Holder { field: 1 reset { } }
      view leaf { render inject \`\`\`ts return null \`\`\` }
      view main { accessible label 2 leaf() }
    `)
    const holder = alias(result.entry.ast, 'holder').value
    Expect.Is(holder, AST.isConfigurationConstructor)
    Expect(holder.block?.entries.map(entry => entry.label ?? entry.name)).toEqual(['field', 'reset'])
    Expect.Is(holder.block?.entries[0]?.expression, AST.isNumberLiteral)
    const label = AST.streamAllContents(result.entry.ast).find(AST.isRenderAccessibilityStatement)
    Expect.Is(label, AST.isRenderAccessibilityStatement)
    Expect.Is(label.value, AST.isNumberLiteral)
    const child = AST.streamAllContents(result.entry.ast).find(AST.isViewRender)
    Expect.Is(child, AST.isViewRender)
    Assert.defined(child.view, 'the child render has a named view reference')
    Expect(child.view.$refText).toBe('leaf')
  })

  Test('preserves lowercase when branches while retaining actual lowercase unit subjects', () => {
    const context = Parser.createContext()
    const parsed = Parser.parseSyntax(
      `
      let compact = when reading > 0 next / not 0
      let quantity = when reading > 2 seconds "slow" / not "fast"
      let nested = "{when reading > 2 Duration.seconds "slow" / not "fast"}"
    `,
      context,
    )
    Expect(parsed.errors).toBe(0)
    const compact = alias(parsed.ast, 'compact').value
    Expect.Is(compact, AST.isWhenExpression)
    Expect.Is(compact.subject, AST.isBinaryExpression)
    Expect.Is(compact.subject.right, AST.isNumberLiteral)
    Expect.Is(compact.positive, AST.isValueReference)
    const quantity = alias(parsed.ast, 'quantity').value
    Expect.Is(quantity, AST.isWhenExpression)
    Expect.Is(quantity.subject, AST.isBinaryExpression)
    Expect.Is(quantity.subject.right, AST.isNumericUnitConstruction)
    Expect(quantity.subject.right.unit.$refText).toBe('seconds')
    const nested = alias(parsed.ast, 'nested').value
    Expect(AST.streamAllContents(nested).filter(AST.isNumericUnitConstruction).map(unit => unit.unit.$refText))
      .toEqual(['Duration.seconds'])
  })

  Test('keeps general member and method spellings unrestricted by the unit suffix rule', async () => {
    const result = await testParseSyntax(`
      let lower = 1.seconds
      let upper = 1.Seconds
      let lowerMethod = (1).inspect()
      let upperMethod = (1).Inspect()
    `)
    const lower = alias(result.entry.ast, 'lower').value
    const upper = alias(result.entry.ast, 'upper').value
    Expect.Is(lower, AST.isPostfixMemberAccess)
    Expect.Is(upper, AST.isPostfixMemberAccess)
    Expect(lower.member).toBe('seconds')
    Expect(upper.member).toBe('Seconds')
    for (const [name, member] of [['lowerMethod', 'inspect'], ['upperMethod', 'Inspect']]) {
      const call = alias(result.entry.ast, name!).value
      Expect.Is(call, AST.isMethodCallExpression)
      Expect.Is(call.callee, AST.isPostfixMemberAccess)
      Expect(call.callee.member).toBe(member)
    }
  })

  for (const value of ['Holder { first: 1 second: 2 }', 'item { first: 1 second: 2 }']) {
    Test(
      `still requires commas between lowercase scalar fields: ${value}`,
      rejectsParser(`
      type Holder is { first number, second number }
      let wrong = ${value}
    `),
    )
  }

  Test('keeps persisted state separate from a numeric constructor whose type name is lowercase', async () => {
    const result = await testParseCode(`
      type width is number
      app Workspace {
        id "com.tao.test.workspace"
        state pane is width = width 320 (persist)
      }
    `)
    const state = AST.streamAllContents(result.entry.ast).find(AST.isStateDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    Expect(state.persist).toBe(true)
    Expect.Is(state.value, AST.isConfigurationConstructor)
    Expect(state.value.type.ref?.name).toBe('width')
    Expect.Is(state.value.value, AST.isNumberLiteral)
    Expect(state.value.value.value).toBe(320)
    Expect(AST.streamAllContents(state).filter(AST.isMethodCallExpression)).toEqual([])
  })
})
