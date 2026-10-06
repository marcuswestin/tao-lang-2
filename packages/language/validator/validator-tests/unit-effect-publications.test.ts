import { ASTUtils } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { testValidateCode } from './test-validate'

const measure = 'type Measure is numeric with { units { seconds 1 (default), minutes 60 } }'

Describe('validator: unit operation effect publications', () => {
  Test('keeps a real unit reading pure before its inherited associated source method', async () => {
    const file = await parse(`
      abstract type Scalar is numeric with {
        func ToText() fails never -> text { return "quantity" }
      }
      type Span is Scalar with { units { seconds 1 (default), minutes 60 } }
      func Read(Value Span) -> text { return Value.seconds().ToText() }
    `)
    const read = namedFunction(file, 'Read')
    const calls = AST.streamAllContents(read).filter(AST.isMethodCallExpression)
    const reading = calls.find(call => AST.isMemberAccessExpression(call.callee))
    const outer = calls.find(call => AST.isPostfixMemberAccess(call.callee))
    Expect.Is(reading, AST.isMethodCallExpression)
    Expect.Is(outer, AST.isMethodCallExpression)
    const { snapshot, projected, facts, analysis } = materialize(file, read)
    const publication = snapshot.units.get(reading)
    Assert.defined(publication, 'the genuine unit invocation has an intrinsic publication')
    Assert(publication.proof.kind === 'numeric-reading', 'the publication retains resolved unit metadata')
    const witness = publication.proof.reading
    Expect(witness.invocation).toBe(reading)
    Expect(witness.concreteFactoryOwner.name).toBe('Span')
    Expect(witness.unitOwner.name).toBe('Span')
    Expect(witness.unit.name).toBe('seconds')
    Assert(witness.receiverAnchor.kind === 'member-path', 'the unit reading retains its named receiver anchor')
    Expect(witness.receiverAnchor.site).toBe(reading.callee)
    Expect(witness.receiverAnchor.members).toEqual([])
    Expect(publication.operands[0]).toBe(reading.callee)
    Expect(snapshot.calls.has(reading)).toBe(false)
    Expect(projected.inputs.calls.some(call => call.site === reading)).toBe(false)
    Expect(projected.inputs.units?.find(row => row.site === reading)?.operands[0]).toBe(reading.callee)
    const outerTarget = snapshot.calls.get(outer)?.target
    Expect.Is(outerTarget, AST.isAssociatedFunctionDeclaration)
    Expect(outerTarget.name).toBe('ToText')
    Expect(facts.find(fact => fact.node === reading)?.executes.some(edge => edge.target === reading.callee)).toBe(true)
    Expect(facts.find(fact => fact.node === outer)?.executes.some(edge => edge.target === outer.callee)).toBe(true)
    Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
    Expect(analysis.effects.failures.open).toBe(true)
    Expect(ASTUtils.createAssociatedEffects([file]).analyses.get(read)?.effects.purity).toEqual({
      violations: [],
      open: false,
    })
  })

  Test(
    'accepts legacy duration construction in arithmetic and comparison without closing checked failures',
    async () => {
      const result = await testValidateCode(`
      func Longer(Wait duration) -> duration { return Wait + 30.seconds }
      func Ratio(Wait duration) -> number { return Wait / 1.min }
      func Same(Left duration) -> boolean { return Left == 60.s }
    `)
      for (
        const [name, unit, ratio] of [
          ['Longer', 'seconds', 1e9],
          ['Ratio', 'min', 60e9],
          ['Same', 's', 1e9],
        ] as const
      ) {
        const owner = namedFunction(result.entry.ast, name)
        const site = AST.streamAllContents(owner).find(AST.isPostfixMemberAccess)
        Expect.Is(site, AST.isPostfixMemberAccess)
        const { snapshot, facts, analysis } = materialize(result.entry.ast, owner)
        const publication = snapshot.units.get(site)
        Assert.defined(publication, 'the genuine legacy construction is published')
        Assert(publication.proof.kind === 'legacy-unit', 'the legacy publication retains family and scale metadata')
        Expect(publication.proof.family).toBe('duration')
        Expect(publication.proof.unit).toBe(unit)
        Expect(publication.proof.ratio).toBe(ratio)
        Expect(publication.operands[0]).toBe(site.receiver)
        Expect(facts.find(fact => fact.node === site)?.executes[0]?.target).toBe(site.receiver)
        Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
        Expect(result.associatedEffects?.analyses.get(owner)?.effects.purity).toEqual({ violations: [], open: false })
        Expect(Object.isFrozen(publication)).toBe(true)
        Expect(Object.isFrozen(publication.operands)).toBe(true)
      }
    },
  )

  Test('publishes a declared numeric suffix with its checked table and actual input', async () => {
    const result = await testValidateCode(`${measure}
      func Build() -> Measure { return 1 seconds }
    `)
    const owner = namedFunction(result.entry.ast, 'Build')
    const site = AST.returnStatementsOf(owner)[0]?.value
    Expect.Is(site, AST.isNumericUnitConstruction)
    const { snapshot, facts, analysis } = materialize(result.entry.ast, owner)
    const publication = snapshot.units.get(site)
    Assert.defined(publication, 'the authored suffix has a resolved intrinsic publication')
    Assert(publication.proof.kind === 'numeric-construction', 'the suffix retains its checked table resolution')
    Expect(publication.proof.resolution.plan.owner.name).toBe('Measure')
    Expect(publication.proof.resolution.unit.name).toBe('seconds')
    Expect(site.unit.ref?.name).toBe('seconds')
    Expect(publication.operands[0]).toBe(site.input)
    Expect(facts.find(fact => fact.node === site)?.executes[0]?.target).toBe(site.input)
    Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
    Expect(analysis.effects.failures).toEqual({ cases: [], open: true })
  })

  Test('keeps postfix receiver calls and live aliases executing beneath an immutable unit selection', async () => {
    const file = await parse(`${measure}
      func Relay(Value Measure) -> Measure { return Value }
      let Imported is Measure = Export from ./Native.ts
      func Alias() -> Measure { return Imported.seconds() }
      view Example {
        state Current is Measure = 1 seconds
        func Read() -> Measure { return Relay(Current).seconds() }
      }
    `)
    const read = namedFunction(file, 'Read')
    const site = AST.streamAllContents(read).find(AST.isMethodCallExpression)
    Expect.Is(site, AST.isMethodCallExpression)
    const receiverCall = site.callee
    Expect.Is(receiverCall, AST.isPostfixMemberAccess)
    const { snapshot, facts, analysis } = materialize(file, read)
    Expect(snapshot.reads.get(receiverCall)?.classification).toBe('immutable')
    Expect(snapshot.reads.get(receiverCall)?.proof?.kind).toBe('unit-selection')
    Expect(facts.find(fact => fact.node === receiverCall)?.executes.some(edge => edge.target === receiverCall.receiver))
      .toBe(true)
    Expect(analysis.effects.purity.violations).toContain('reactive-state')
    const alias = materialize(file, namedFunction(file, 'Alias'))
    const aliasDeclaration = file.statements.find(AST.isAliasDeclaration)
    Expect.Is(aliasDeclaration, AST.isAliasDeclaration)
    Expect(alias.facts.some(fact => fact.executes.some(edge => edge.target === aliasDeclaration.value))).toBe(true)
    Expect(alias.analysis.effects.purity.open).toBe(true)
  })

  Test('retains reactive and unknown ownership on direct named receivers', async () => {
    const file = await parse(`${measure}
      data Samples / Sample { Elapsed Measure }
      func Field(Value Sample) -> Measure { return Value.Elapsed.seconds() }
      func Mutable(mutable Value Measure) -> Measure { return Value.seconds() }
      func Copy(copy Value Measure) -> Measure { return Value.seconds() }
      view Example {
        state Current is Measure = 1 seconds
        func State() -> Measure { return Current.seconds() }
      }
    `)
    for (const name of ['Mutable', 'Copy', 'State']) {
      const { snapshot, analysis } = materialize(file, namedFunction(file, name))
      const call = AST.streamAllContents(namedFunction(file, name)).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      Expect(snapshot.units.has(call)).toBe(true)
      Expect(snapshot.reads.get(call.callee)?.classification).toBe('reactive')
      Expect(analysis.effects.purity.violations).toContain('reactive-state')
    }
    const field = materialize(file, namedFunction(file, 'Field'))
    const call = AST.streamAllContents(namedFunction(file, 'Field')).find(AST.isMethodCallExpression)
    Expect.Is(call, AST.isMethodCallExpression)
    Expect(field.snapshot.units.has(call)).toBe(true)
    Expect(field.snapshot.reads.get(call.callee)?.classification).toBe('unknown')
    Expect(field.analysis.effects.purity.open).toBe(true)
  })

  Test('leaves invalid arguments, missing units and unrelated members outside intrinsic execution', async () => {
    const file = await parse(
      `${measure}
      func Arguments(Value Measure) -> Measure { return Value.seconds(1) }
      func Missing(Value Measure) -> Measure { return Value.hours() }
      func Unknown() -> duration { return 1.furlongs }
      func Unresolved() -> Measure { return 1 absent }
      func InvalidBacking() -> Measure { return ("text") seconds }
    `,
      true,
    )
    for (const name of ['Arguments', 'Missing', 'Unknown', 'Unresolved', 'InvalidBacking']) {
      const owner = namedFunction(file, name)
      const site = AST.returnStatementsOf(owner)[0]?.value
      Assert.defined(site, 'the invalid unit fixture has its actual return expression')
      const { snapshot, analysis } = materialize(file, owner)
      Expect(snapshot.units.has(site)).toBe(false)
      Expect(analysis.effects.purity.open).toBe(true)
      if (AST.isMethodCallExpression(site)) {
        Expect(snapshot.calls.get(site)?.kind).toBe('unknown')
      }
    }
  })
})

async function parse(source: string, allowUnresolved = false): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  if (!allowUnresolved) {
    Expect(parsed.diagnostics).toEqual([])
  }
  return parsed.entry.ast
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = AST.streamAllContents(file).find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}

function materialize(file: AST.TaoFile, owner: AST.Node) {
  const snapshot = ASTUtils.publishCanonicalEffectSnapshot([file])
  const projected = ASTUtils.projectCallableEffectPublications(snapshot, owner)
  const facts = ASTUtils.discoverCallableEffectFacts(owner, projected.inputs, projected.context)
  return { snapshot, projected, facts, analysis: ASTUtils.analyzeCallableEffects(owner, facts) }
}
