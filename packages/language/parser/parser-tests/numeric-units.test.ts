import { Workspace } from '@compiler/workspace'
import { AST, Parser } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { rejectsParser, testParseCode, testParseSyntax } from './test-parse'

const measure = 'type Measure is numeric with { units { seconds 1 (default), minutes 60 } }'

function alias(file: AST.TaoFile, name: string): AST.AliasDeclaration {
  const declaration = file.statements.find(statement => AST.isAliasDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isAliasDeclaration)
  return declaration
}

Describe('parser: numeric units', () => {
  Test('keeps signed construction, outer negation, grouping and precedence distinct', async () => {
    const result = await testParseCode(`${measure}
      let Signed = -2 seconds
      let Negated = -(2 seconds)
      let Grouped = (1 + 2) Measure.minutes
      let Product = 2 seconds * 3
      let Legacy = 2.ms
    `)
    const signed = alias(result.entry.ast, 'Signed').value
    Expect.Is(signed, AST.isNumericUnitConstruction)
    Expect.Is(signed.input, AST.isUnaryExpression)
    Expect(signed.input.operator).toBe('-')
    Expect.Is(signed.input.operand, AST.isNumberLiteral)
    Expect(AST.numericUnitConstructionInputIsAllowed(signed)).toBe(true)
    const negated = alias(result.entry.ast, 'Negated').value
    Expect.Is(negated, AST.isUnaryExpression)
    Expect.Is(negated.operand, AST.isNumericUnitConstruction)
    const grouped = alias(result.entry.ast, 'Grouped').value
    Expect.Is(grouped, AST.isNumericUnitConstruction)
    Expect.Is(grouped.input, AST.isBinaryExpression)
    Expect(grouped.unit.$refText).toBe('Measure.minutes')
    Expect(AST.numericUnitConstructionInputIsAllowed(grouped)).toBe(true)
    const product = alias(result.entry.ast, 'Product').value
    Expect.Is(product, AST.isBinaryExpression)
    Expect.Is(product.left, AST.isNumericUnitConstruction)
    Expect.Is(product.right, AST.isNumberLiteral)
    Expect.Is(alias(result.entry.ast, 'Legacy').value, AST.isPostfixMemberAccess)
  })

  Test('keeps grouping and comments available to source-shape checks', async () => {
    const result = await testParseCode(`${measure}
      let Quantity = (/* input */ 1 + (2)) /* unit */ seconds
    `)
    const quantity = alias(result.entry.ast, 'Quantity').value
    Expect.Is(quantity, AST.isNumericUnitConstruction)
    Expect(AST.numericUnitConstructionInputIsAllowed(quantity)).toBe(true)
  })

  Test('preserves compact when branches beside literal inputs and accepts quantity subjects', async () => {
    const result = await testParseSyntax(`${measure}
      let Compact = when Left > 0 Left.Clock / not "Time's up"
      let Arithmetic = when Left > 0 Left.Clock + 1 / not 0
      let Quantity = when Reading > 2 seconds "slow" / not "fast"
      let Qualified = when Reading > -2 Measure.seconds "slow" / not "fast"
      let Grouped = when Reading > (1 + 2) seconds "slow" / not "fast"
      let Commented = when Left > 0 /* branch */ Left.Clock / not "done"
      let Block = when Reading > 2 seconds { true -> "slow" otherwise -> "fast" }
    `)
    for (const name of ['Compact', 'Arithmetic', 'Commented']) {
      const expression = alias(result.entry.ast, name).value
      Expect.Is(expression, AST.isWhenExpression)
      Expect.Is(expression.subject, AST.isBinaryExpression)
      Expect.Is(expression.subject.right, AST.isNumberLiteral)
      Expect(expression.positive).toBeDefined()
      Expect(expression.negative).toBeDefined()
    }
    for (const name of ['Quantity', 'Qualified', 'Grouped', 'Block']) {
      const expression = alias(result.entry.ast, name).value
      Expect.Is(expression, AST.isWhenExpression)
      Expect.Is(expression.subject, AST.isBinaryExpression)
      Expect.Is(expression.subject.right, AST.isNumericUnitConstruction)
    }
  })

  Test('resolves later and nested when suffix choices without reentering the parser', () => {
    const context = Parser.createContext()
    const sources = [
      'let X = when Reading > 2 seconds and Left > 0 Left.Clock + 1 / not 0',
      'let X = when Reading > 2 seconds (when Left > 0 Left.Clock / not 0) / not 0',
      'let X = when Reading > (when Left > 0 2 / not 3) seconds "slow" / not "fast"',
      'let X = when Reading > 2 seconds { true -> when Left > 0 Left.Clock / not 0 otherwise -> 0 }',
      'let X = when Reading > 2 seconds | true -> 1 | otherwise -> 0',
    ]
    for (const source of sources) {
      Expect(Parser.parseSyntax(source, context).errors).toBe(0)
    }
    for (
      const source of ['let X = when Reading > 2 seconds "slow" / not', 'let X = when Reading > 2 seconds { true -> 1']
    ) {
      Expect(Parser.parseSyntax(source, context).errors).toBeGreaterThan(0)
      Expect(Parser.parseSyntax(sources[0]!, context).errors).toBe(0)
    }
  })

  Test('preserves quantity subjects in surrounding block and interpolation lexer contexts', () => {
    const context = Parser.createContext()
    const sources = [
      'let X = Holder { A: when Reading > 2 seconds "slow" / not "fast" }',
      'let X = when Ready { true -> when Reading > 2 seconds "slow" / not "fast" otherwise -> 0 }',
      'let X = "{when Reading > 2 seconds "slow" / not "fast"}"',
    ]
    for (const source of sources) {
      const parsed = Parser.parseSyntax(source, context)
      Expect(parsed.errors).toBe(0)
      const expression = AST.streamAllContents(parsed.ast).filter(AST.isWhenExpression)
        .find(node => AST.isBinaryExpression(node.subject))
      Expect.Is(expression, AST.isWhenExpression)
      Expect.Is(expression.subject, AST.isBinaryExpression)
      Expect.Is(expression.subject.right, AST.isNumericUnitConstruction)
      Expect(expression.positive).toBeDefined()
      Expect(expression.negative).toBeDefined()
    }
    const invalidTail = Parser.parseSyntax('let X = when Reading > 2 seconds "slow" / not "fast"\n$', context)
    Expect(invalidTail.errors).toBeGreaterThan(0)
    const expression = alias(invalidTail.ast, 'X').value
    Expect.Is(expression, AST.isWhenExpression)
    Expect.Is(expression.subject, AST.isBinaryExpression)
    Expect.Is(expression.subject.right, AST.isNumericUnitConstruction)
  })

  Test('retains every quantity in a longer header while leaving its compact branch intact', () => {
    const conditions = Array.from({ length: 24 }, (_, index) => `Reading > ${index + 1} seconds`)
    const parsed = Parser.parseSyntax(`let X = when ${conditions.join(' and ')} and Left > 0 Left.Clock / not 0`)
    Expect(parsed.errors).toBe(0)
    const expression = alias(parsed.ast, 'X').value
    Expect.Is(expression, AST.isWhenExpression)
    Expect(AST.streamAllContents(expression.subject!).filter(AST.isNumericUnitConstruction).length).toBe(24)
    Expect.Is(expression.positive, AST.isMemberAccessExpression)
    Expect.Is(expression.negative, AST.isNumberLiteral)
  })

  for (const input of ['Value', 'Value.Member', '--2', 'not 2', '2.ms']) {
    Test(`requires a literal or complete grouped input: ${input}`, async () => {
      const result = await testParseSyntax(`${measure}
      let Value = 2
      let Wrong = ${input} seconds
      `)
      const wrong = alias(result.entry.ast, 'Wrong').value
      Expect(wrong).toBeDefined()
      Expect(AST.isNumericUnitConstruction(wrong)).toBe(false)
      Expect(Diagnostics.errorMessages(result.diagnostics).length).toBeGreaterThan(0)
    })
  }

  Test('preserves directly owned unit rows, including invalid rows for validator diagnostics', async () => {
    const result = await testParseSyntax(`
      type Measure is numeric with {
        units { seconds 1 (default), minutes -60, seconds 0 (default) }
      }
    `)
    const declaration = result.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(declaration, AST.isTypeDeclaration)
    Expect.Is(declaration.type, AST.isDerivedTypeExpression)
    Expect(declaration.type.slots.unitBlocks[0]?.units.map(unit => [unit.name, unit.sign, unit.scale, unit.default]))
      .toEqual([['seconds', undefined, 1, true], ['minutes', '-', 60, false], ['seconds', undefined, 0, true]])
  })

  Test('requires adjacent value commas and lets directives reset the separator state', async () => {
    const result = await testParseSyntax(`
      type Holder is { A number, B number, C number }
      let First = Holder { Reset { } A: 1, B: 2 Reset { } C: 3, }
      let Second = Holder { A: 1, Reset { }, Reset { } B: 2, C: 3 }
      let Item = item { A: 1, B: 2, }
    `)
    const first = alias(result.entry.ast, 'First').value
    Expect.Is(first, AST.isConfigurationConstructor)
    Expect(first.block?.entries.map(entry => entry.label ?? entry.name)).toEqual(['Reset', 'A', 'B', 'Reset', 'C'])
    const second = alias(result.entry.ast, 'Second').value
    Expect.Is(second, AST.isConfigurationConstructor)
    Expect(second.block?.entries.map(entry => entry.label ?? entry.name)).toEqual(['A', 'Reset', 'Reset', 'B', 'C'])
  })

  for (const value of ['Holder { A: 1 B: 2 }', 'Holder { A: 1, B: 2 C: 3 }', 'item { A: 1 B: 2 }']) {
    Test(
      `rejects omitted adjacent value commas: ${value}`,
      rejectsParser(`
      type Holder is { A number, B number, C number }
      let Wrong = ${value}
    `),
    )
  }

  Test('links imported, namespace and transparent alias routes to the same canonical row', async () => {
    await withTaoFiles('tao-numeric-unit-imports-', {
      'Main.tao': `
        use Measure from ./library/Measure
        use package ./library as library
        type Renamed = library.Measure
        let Short = 2 seconds
        let Named = 2 Measure.seconds
        let Qualified = 2 library.Measure.seconds
        let Aliased = 2 Renamed.seconds
      `,
      'library/Measure.tao': `public ${measure}`,
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      Expect(Diagnostics.errorMessages(result.diagnostics)).toEqual([])
      const constructions = result.entry.ast.statements.filter(AST.isAliasDeclaration).map(declaration =>
        declaration.value
      )
      constructions.forEach(construction => Expect.Is(construction, AST.isNumericUnitConstruction))
      const units = constructions.filter(AST.isNumericUnitConstruction).map(construction => construction.unit.ref)
      Expect(units[0]).toBeDefined()
      units.forEach(unit => Expect(unit).toBe(units[0]))
    })
  })

  Test('rejects shorthand shared by distinct owners while qualified names remain linked', async () => {
    const result = await testParseSyntax(`${measure}
      type Other is numeric with { units { seconds 1 (default) } }
      let Ambiguous = 2 seconds
      let First = 2 Measure.seconds
      let Second = 2 Other.seconds
    `)
    const ambiguous = alias(result.entry.ast, 'Ambiguous').value
    Expect.Is(ambiguous, AST.isNumericUnitConstruction)
    Expect(ambiguous.unit.ref).toBeUndefined()
    const first = alias(result.entry.ast, 'First').value
    const second = alias(result.entry.ast, 'Second').value
    Expect.Is(first, AST.isNumericUnitConstruction)
    Expect.Is(second, AST.isNumericUnitConstruction)
    Expect(first.unit.ref).toBeDefined()
    Expect(second.unit.ref).toBeDefined()
    Expect(first.unit.ref).not.toBe(second.unit.ref)
    Expect(Diagnostics.errorMessages(result.diagnostics).some(message => message.includes('seconds'))).toBe(true)
  })
})
