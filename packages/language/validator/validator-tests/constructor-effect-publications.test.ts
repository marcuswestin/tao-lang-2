import { ASTUtils } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AssociatedMethodsValidationMessages as messages } from '../validator-src/validators/AssociatedMethodsValidationMessages'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: named constructor effect publications', () => {
  Test('accepts the actual static text Default and retains its constructor payload edge', async () => {
    const result = await testValidateCode(`
      type Title is text with { static func Default() { return Title "Library" } }
    `)
    const owner = result.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(owner, AST.isTypeDeclaration)
    const method = AST.streamAllContents(owner).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    Expect(method.static).toBe(true)
    const constructor = AST.returnStatementsOf(method)[0]?.value
    Expect.Is(constructor, AST.isConfigurationConstructor)
    Expect(constructor.type.ref).toBe(owner)
    Expect.Is(constructor.value, AST.isStringLiteral)
    Expect(constructor.value.value).toBe('Library')
    const { snapshot, projected, facts } = materialize(result.entry.ast, method)
    const publication = snapshot.constructors.get(constructor)
    Assert.defined(publication, 'the production factory publishes the actual constructor')
    Expect(publication.site).toBe(constructor)
    Expect(publication.declaration).toBe(owner)
    Expect(publication.kind).toBe('complete')
    Assert(publication.result.kind === 'primitive', 'the real resolved constructor is primitive text')
    Expect(publication.result.primitive).toBe('text')
    Expect(publication.operands.length).toBe(1)
    Expect(publication.operands[0]).toBe(constructor.value)
    Expect(Object.isFrozen(publication)).toBe(true)
    Expect(Object.isFrozen(publication.operands)).toBe(true)
    Expect(projected.inputs.constructors?.find(row => row.site === constructor)?.operands[0]).toBe(constructor.value)
    const fact = facts.find(row => row.node === constructor)
    Assert.defined(fact, 'discovery consumes the actual wrapper publication')
    Expect(fact.kind).toBe('complete')
    Expect(fact.executes.length).toBe(1)
    Expect(fact.executes[0]?.site).toBe(constructor)
    Expect(fact.executes[0]?.target).toBe(constructor.value)
    Expect(facts.find(row => row.node === constructor.value)?.kind).toBe('complete')
    Expect(result.associatedEffects?.analyses.get(method)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('keeps an imported operand unknown beneath a complete text wrapper', async () => {
    const result = await testValidateCodeWithErrors(`
      let Host is text = Export from ./Native.ts
      type Title is text with { static func Default() { return Title Host } }
    `)
    Expect(validationErrorMessages(result)).toEqual([messages.purity('Default')])
    const method = AST.streamAllContents(result.entry.ast).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const constructor = AST.returnStatementsOf(method)[0]?.value
    Expect.Is(constructor, AST.isConfigurationConstructor)
    Expect.Is(constructor.value, AST.isValueReference)
    const { snapshot, facts } = materialize(result.entry.ast, method)
    Expect(snapshot.constructors.get(constructor)?.kind).toBe('complete')
    Expect(facts.find(row => row.node === constructor)?.executes.some(edge => edge.target === constructor.value)).toBe(
      true,
    )
    Expect(result.associatedEffects?.analyses.get(method)?.effects).toEqual({
      purity: { violations: [], open: true },
      failures: { cases: [], open: true },
    })
  })

  Test('propagates a modeled native operand failure through the text wrapper', async () => {
    const result = await testValidateCodeWithErrors(`
      func Native() fails Broken -> text { return Export() from ./Native.ts }
      let Payload is text = Native()
      type Title is text with {
        static func Default() fails never -> Title { return Title Payload }
      }
    `)
    Expect(validationErrorMessages(result)).toEqual([messages.failures('Default')])
    const method = AST.streamAllContents(result.entry.ast).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const constructor = AST.returnStatementsOf(method)[0]?.value
    Expect.Is(constructor, AST.isConfigurationConstructor)
    Expect.Is(constructor.value, AST.isValueReference)
    const alias = constructor.value.target.ref
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isFunctionCallExpression)
    const { snapshot, facts } = materialize(result.entry.ast, method)
    Expect(snapshot.constructors.get(constructor)?.kind).toBe('complete')
    Expect(facts.find(row => row.node === constructor)?.executes.some(edge => edge.target === constructor.value)).toBe(
      true,
    )
    Expect(facts.find(row => row.node === constructor.value)?.executes.some(edge => edge.target === alias.value)).toBe(
      true,
    )
    Expect(result.associatedEffects?.analyses.get(method)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: ['Broken'], open: false },
    })
  })

  Test('keeps a bare static type name outside constructor execution evidence', async () => {
    const result = await testValidateCodeWithErrors(`
      type Title is text with { static func Default() { return Title } }
    `)
    Expect(validationErrorMessages(result)).toEqual(["No value named 'Title' is in scope."])
    const method = AST.streamAllContents(result.entry.ast).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const reference = AST.returnStatementsOf(method)[0]?.value
    Expect.Is(reference, AST.isValueReference)
    const { snapshot, facts } = materialize(result.entry.ast, method)
    Expect(snapshot.constructors.has(reference)).toBe(false)
    Expect(snapshot.reads.get(reference)?.kind).toBe('unknown')
    Expect(facts.find(row => row.node === reference)?.kind).toBe('unknown')
    Expect(ASTUtils.analyzeCallableEffects(method, facts).effects.purity.open).toBe(true)
  })

  Test('keeps numeric checks and block construction conservatively unpublished for execution', async () => {
    const parsed = await Parser.parseCode(
      `
      type Count is numeric with { static func Default() { return Count 1 } }
      type Card is { Value text }
      func NewCard() -> Card { return Card { Value "card" } }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    Expect(parsed.diagnostics).toEqual([])
    const constructors = AST.streamAllContents(parsed.entry.ast).filter(AST.isConfigurationConstructor)
    Expect(constructors.length).toBe(2)
    const snapshot = ASTUtils.publishCanonicalEffectSnapshot([parsed.entry.ast])
    Expect(constructors.map(constructor => snapshot.constructors.get(constructor)?.kind)).toEqual([
      'unknown',
      'unknown',
    ])
    const method = AST.streamAllContents(parsed.entry.ast).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const { facts } = materialize(parsed.entry.ast, method)
    const constructor = constructors[0]!
    Expect.Is(constructor.value, AST.isNumberLiteral)
    Expect(facts.find(row => row.node === constructor)?.kind).toBe('unknown')
    Expect(facts.find(row => row.node === constructor)?.executes.some(edge => edge.target === constructor.value)).toBe(
      true,
    )
  })
  Test('keeps a linked constructor with an unresolved declared domain incomplete', async () => {
    const parsed = await Parser.parseCode(
      `
      type Title is Missing
      func Default() { return Title "Library" }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    Expect(parsed.diagnostics).toEqual([])
    const declaration = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    const fn = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(declaration, AST.isTypeDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    const constructor = AST.returnStatementsOf(fn)[0]?.value
    Expect.Is(constructor, AST.isConfigurationConstructor)
    Expect(constructor.type.ref).toBe(declaration)
    Expect.Is(constructor.value, AST.isStringLiteral)
    const { snapshot, facts } = materialize(parsed.entry.ast, fn)
    const publication = snapshot.constructors.get(constructor)
    Expect(publication?.result.kind).toBe('unresolved')
    Expect(publication?.kind).toBe('unknown')
    Expect(facts.find(row => row.node === constructor)?.kind).toBe('unknown')
    Expect(facts.find(row => row.node === constructor.value)?.kind).toBe('complete')
    Expect(ASTUtils.analyzeCallableEffects(fn, facts).effects).toEqual({
      purity: { violations: [], open: true },
      failures: { cases: [], open: true },
    })
  })
})

function materialize(file: AST.TaoFile, owner: AST.Node) {
  const snapshot = ASTUtils.publishCanonicalEffectSnapshot([file])
  const projected = ASTUtils.projectCallableEffectPublications(snapshot, owner)
  const facts = ASTUtils.discoverCallableEffectFacts(owner, projected.inputs, projected.context)
  return { snapshot, projected, facts }
}
