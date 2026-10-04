import { ASTUtils, Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import {
  accepts,
  rejects,
  testValidateCode,
  testValidateCodeWithErrors,
  validationErrorMessages,
} from './test-validate'

const hierarchy = `
  type Root is text
  type Inner is Root
  type Leaf is Inner
  type Cousin is Root
  function Combine(Narrow Inner, Wide Root) { return "{ Narrow }/{ Wide }" }
`

Describe('validator: callable binding', () => {
  for (const argumentsSource of ['Leaf "leaf", Cousin "cousin"', 'Cousin "cousin", Leaf "leaf"']) {
    Test(`resolves the unique maximum matching for ${argumentsSource}`, async () => {
      const result = await testValidateCode(`${hierarchy}\nlet Result = Combine(${argumentsSource})`)
      const resultAlias = result.entry.ast.statements.find(AST.isAliasDeclaration)
      Expect.Is(resultAlias, AST.isAliasDeclaration)
      Expect.Is(resultAlias.value, AST.isFunctionCallExpression)
      const resolved = ASTUtils.resolveFunctionInvocation(resultAlias.value)
      Expect(resolved.diagnostics).toEqual([])
      Expect(
        resolved.pairs.map(
          pair => [Type.parameterName(pair.parameter), Type.displayName(Type.ofArgument(pair.argument))],
        ),
      )
        .toEqual([['Narrow', 'Leaf'], ['Wide', 'Cousin']])
      Expect(Type.displayName(Type.ofExpression(resultAlias.value))).toBe('text')
    })
  }

  for (const argumentsSource of ['Right: Name "right", Left: Name "left"', 'Left: Name "left", Name "right"']) {
    Test(
      `binds repeated named identities through directed roles: ${argumentsSource}`,
      accepts(`
      type Name is text
      function Pair(Left Name, Right Name) { return "{ Left }/{ Right }" }
      let Result = Pair(${argumentsSource})
    `),
    )
  }

  Test(
    'rejects undirected repeated inputs without positional ties',
    rejects(
      `
    type Name is text
    function Pair(Left Name, Right Name) { return "{ Left }/{ Right }" }
    let Result = Pair(Name "left", Name "right")
  `,
      FunctionsValidator.messages.functionDuplicateArgumentType('Pair'),
    ),
  )

  Test('reports each missing repeated role when no values are supplied', async () => {
    const result = await testValidateCodeWithErrors(`
      type Name is text
      function Pair(Left Name, Right Name) { return "{ Left }/{ Right }" }
      let Result = Pair()
    `)
    Expect(validationErrorMessages(result)).toEqual([
      FunctionsValidator.messages.functionMissingArgument('Pair', 'Left'),
      FunctionsValidator.messages.functionMissingArgument('Pair', 'Right'),
    ])
  })

  Test('reports residual extra and missing values after the maximal valid binding', async () => {
    const result = await testValidateCodeWithErrors(`
      ${hierarchy}
      function Complete(Narrow Inner, Wide Root, Flag boolean) { return "{ Narrow }/{ Wide }/{ Flag }" }
      let Result = Complete(Cousin "cousin", 42, Leaf "leaf")
    `)
    Expect(validationErrorMessages(result)).toEqual([
      FunctionsValidator.messages.functionUnmatchedArgument('Complete'),
      FunctionsValidator.messages.functionMissingArgument('Complete', 'Flag'),
    ])
    const alias = result.entry.ast.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isFunctionCallExpression)
    Expect(ASTUtils.resolveFunctionInvocation(alias.value).pairs.map(pair => Type.parameterName(pair.parameter)))
      .toEqual(['Narrow', 'Wide'])
  })

  Test('does not choose one of multiple equally valid maximum assignments', async () => {
    const result = await testValidateCodeWithErrors(`
      ${hierarchy}
      type OtherLeaf is Inner
      let Result = Combine(Leaf "leaf", OtherLeaf "other")
    `)
    const fn = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    Expect(validationErrorMessages(result)).toContain(
      FunctionsValidator.messages.functionAmbiguousArgument('Combine', AST.parametersOf(fn)),
    )
    const alias = result.entry.ast.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isFunctionCallExpression)
    Expect(ASTUtils.resolveFunctionInvocation(alias.value).pairs).toEqual([])
  })

  Test('keeps forced pairs while reporting a separate ambiguous component', async () => {
    const result = await testValidateCodeWithErrors(`
      type Root is text
      type Inner is Root
      type OtherInner is Root
      type LeftLeaf is Inner
      type RightLeaf is Inner
      type OtherLeaf is OtherInner
      function Combine(First Inner, Wide Root, Other OtherInner) { return "{ First }/{ Wide }/{ Other }" }
      let Result = Combine(RightLeaf "right", OtherLeaf "other", LeftLeaf "left")
    `)
    const alias = result.entry.ast.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isFunctionCallExpression)
    const resolved = ASTUtils.resolveFunctionInvocation(alias.value)
    Expect(
      resolved.pairs.map(
        pair => [Type.parameterName(pair.parameter), Type.displayName(Type.ofArgument(pair.argument))],
      ),
    )
      .toEqual([['Other', 'OtherLeaf']])
    Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind))
      .toEqual(['ambiguous-argument', 'ambiguous-argument', 'ambiguous-parameter', 'ambiguous-parameter'])
  })

  Test(
    'retains named, aliased and dynamic action resolution',
    accepts(`
    type Name is text
    action Save(Left Name, Right Name) { }
    let Bound = Save
    action Run() { do Save(Right: Name "right", Left: Name "left") do Bound(Left: Name "left", Right: Name "right") }
    action Forward(Callback action(text)) { do Callback("value") }
  `),
  )
  for (
    const [value, expectedDiagnostics] of [
      ['[1]', []],
      ['["bad"]', ['unmatched-property', 'missing-property']],
    ] as const
  ) {
    Test(`checks list element admission in the shared constructor binder for ${value}`, async () => {
      const parsed = await Parser.parseCode(`
        type Numbers is list of number
        type Payload is { Values Numbers }
        let Raw = item { ${value} }
      `)
      Expect(parsed.diagnostics).toEqual([])
      const shape = parsed.entry.ast.statements.find(statement =>
        AST.isTypeDeclaration(statement) && statement.name === 'Payload'
      )
      const alias = parsed.entry.ast.statements.find(AST.isAliasDeclaration)
      Expect.Is(shape, AST.isTypeDeclaration)
      Expect.Is(shape.type, AST.isItemTypeExpression)
      Expect.Is(alias, AST.isAliasDeclaration)
      Expect.Is(alias.value, AST.isTypedConstructor)
      Expect.Is(alias.value.value, AST.isItemLiteral)
      const resolved = ASTUtils.resolveItemPropertyBindings(shape.type.properties, alias.value.value.properties)
      Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(expectedDiagnostics)
      Expect(resolved.pairs.map(pair => pair.expected.name)).toEqual(expectedDiagnostics.length === 0 ? ['Values'] : [])
    })
  }

  Test('constructs a scoped field from one admitted descendant without changing its identity', async () => {
    const result = await testValidateCode(`
      type Base is text
      type Leaf is Base
      type Payload is { Label Base }
      let Value = Payload { Leaf "value" }
    `)
    const payload = result.entry.ast.statements.find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Payload'
    )
    Expect.Is(payload, AST.isTypeDeclaration)
    Expect.Is(payload.type, AST.isItemTypeExpression)
    Expect(Type.displayName(Type.ofProperty(payload.type.properties[0]!))).toBe('Payload.Label')
  })
})
