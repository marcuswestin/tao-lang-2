import { AST, Parser } from '@parser'
import { Assert, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  capabilityRequirements,
  ownAssociatedMethods,
} from '../ast-utils-src/associated-methods'
import { discoverCallableEffectFacts } from '../ast-utils-src/callable-effect-facts'
import type { NativeEffectPublication } from '../ast-utils-src/callable-effect-facts'
import { projectCallableEffectPublications } from '../ast-utils-src/callable-effect-publications'
import { analyzeCallableEffects } from '../ast-utils-src/callable-effects'
import {
  publishCanonicalEffectSnapshot,
} from '../ast-utils-src/canonical-effect-snapshot'

Describe('Canonical callable effect projection', () => {
  Test('discovers and closes a real uncalled pure associated method root', async () => {
    const file = await parse(`
      type Title is text with {
        func ToText() fails never { return "{Title}" }
      }
    `)
    const title = namedType(file, 'Title')
    const method = ownAssociatedMethods(title)[0]
    Assert.defined(method, 'the Title type has its source method')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, method)
    const facts = discoverCallableEffectFacts(method, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(method, facts)
    const contextualRead = [...snapshot.reads.values()].find(read => read.proof?.kind === 'contextual-owner')

    Assert.defined(contextualRead, 'the interpolation publishes its contextual Title read')
    Expect(contextualRead.proof?.owner).toBe(title)
    Expect(projected.context.root?.node).toBe(method)
    Expect(projected.context.root?.bodies[0]).toBe(method.block)
    Expect(facts.some(fact => fact.node === method)).toBe(true)
    Expect(facts.some(fact => fact.node === method.block)).toBe(true)
    Expect(facts.some(fact => fact.node === method.parameterList)).toBe(false)
    Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
    Expect(analysis.effects.failures).toEqual({ cases: [], open: false })
  })

  Test('carries a live alias through its actual reactive initializer path', async () => {
    const file = await parse(`
      view Example {
        state Counter = 1
        let Live = Counter
        func Read() -> text { return "{Live}" }
      }
    `)
    const read = namedFunction(file, 'Read')
    const alias = AST.streamAllContents(file).find(value => AST.isAliasDeclaration(value) && value.name === 'Live')
    const state = AST.streamAllContents(file).find(value => AST.isStateDeclaration(value) && value.name === 'Counter')
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const reference = AST.streamAllContents(read).find(value =>
      AST.isValueReference(value) && value.target.ref === alias
    )
    Expect.Is(reference, AST.isValueReference)
    const projected = projectCallableEffectPublications(snapshot, read)
    const fact = discoverCallableEffectFacts(read, projected.inputs, projected.context).find(value =>
      value.node === reference
    )
    const analysis = analyzeCallableEffects(
      read,
      discoverCallableEffectFacts(read, projected.inputs, projected.context),
    )
    const readPublication = projected.inputs.reads.find(value => value.reference === reference)

    Assert.defined(fact, 'the actual alias reference is discovered')
    Assert.defined(readPublication, 'the alias reference has a projected read publication')
    Expect(readPublication.classification).toBe('immutable')
    Expect(readPublication.initializer).toBe(alias.value)
    Expect(fact.executes.some(edge => edge.target === alias.value)).toBe(true)
    Expect(snapshot.reads.get(alias.value)?.classification).toBe('reactive')
    Expect(snapshot.reads.get(alias.value)?.declaration).toBe(state)
    Expect(projected.inputs.reads.some(value => value.reference === alias.value)).toBe(true)
    Expect(analysis.effects.purity.violations).toContain('reactive-state')
    Expect(analysis.effects.purity.open).toBe(false)
  })

  Test('keeps real computed receivers while unsupported construction stays open', async () => {
    const file = await parse(`
      type Token is text with {
        func Again() fails never -> Token { return Token }
        func Format() fails never -> text { return "token" }
      }
      func Build() -> Token { return Token "value" }
      func Chain() -> text { return Build().Again().Format() }
    `)
    const token = namedType(file, 'Token')
    const [again, format] = ownAssociatedMethods(token)
    const build = namedFunction(file, 'Build')
    const chain = namedFunction(file, 'Chain')
    Assert.defined(again, 'Token declares Again')
    Assert.defined(format, 'Token declares Format')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, chain)
    const facts = discoverCallableEffectFacts(chain, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(chain, facts)
    const computedCalls = [...snapshot.calls.values()].filter(value =>
      value.target === again || value.target === format
    )
    const buildCall = [...snapshot.calls.values()].find(value => value.target === build)
    Assert(computedCalls.length >= 2, 'both actual computed method calls are published')
    Assert.defined(buildCall, 'the computed receiver invocation has a canonical row')

    Expect(computedCalls.every(value => AST.isMethodCallExpression(value.site))).toBe(true)
    Expect(facts.some(fact => fact.node === build.block)).toBe(true)
    Expect(facts.some(fact => fact.node === again.block)).toBe(true)
    Expect(facts.some(fact => fact.node === format.block)).toBe(true)
    Expect(facts.some(fact => fact.node === again.parameterList || fact.node === format.parameterList)).toBe(false)
    Expect(facts.some(fact => fact.node === again.returnType || fact.node === format.returnType)).toBe(false)
    Expect(facts.some(fact => fact.node === buildCall.site)).toBe(true)
    Expect(facts.some(fact => fact.executes.some(edge => edge.target === buildCall.site))).toBe(true)
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
  })

  Test('closes parameter-based static selections and preserves reactive receiver violations', async () => {
    const pureFile = await parse(`
      type Token is text with {
        func Again() fails never -> Token { return Token }
        func Format() fails never -> text { return "token" }
      }
      func Build(Value Token) fails never -> Token { return Value }
      func Chain(Value Token) fails never -> text { return Build(Value).Again().Format() }
    `)
    const pureToken = namedType(pureFile, 'Token')
    const pureMethods = ownAssociatedMethods(pureToken)
    const again = pureMethods.find(value => value.name === 'Again')
    const format = pureMethods.find(value => value.name === 'Format')
    const chain = namedFunction(pureFile, 'Chain')
    Assert.defined(again, 'Token declares the pure Again method')
    Assert.defined(format, 'Token declares the pure Format method')
    const pureSnapshot = publishCanonicalEffectSnapshot([pureFile])
    const methodCalls = AST.streamAllContents(chain).filter(AST.isMethodCallExpression)
    const pureProjected = projectCallableEffectPublications(pureSnapshot, chain)
    const pureFacts = discoverCallableEffectFacts(chain, pureProjected.inputs, pureProjected.context)
    const pureAnalysis = analyzeCallableEffects(chain, pureFacts)

    Expect(methodCalls).toHaveLength(2)
    for (const call of methodCalls) {
      Expect.Is(call.callee, AST.isPostfixMemberAccess)
      const selection = pureProjected.inputs.reads.find(read => read.reference === call.callee)
      Assert.defined(selection, 'each computed method callee has a projected selection read')
      const canonicalSelection = pureSnapshot.reads.get(call.callee)
      Assert.defined(canonicalSelection, 'the factory retains each static selection proof')
      Expect(selection.kind).toBe('complete')
      Expect(selection.classification).toBe('immutable')
      Assert(
        canonicalSelection.proof?.kind === 'static-method-selection',
        'the selection carries its independent static proof',
      )
      Expect(canonicalSelection.proof.owner).toBe(pureToken)
      Expect(pureFacts.find(fact => fact.node === call.callee)?.kind).toBe('complete')
    }
    Expect(pureSnapshot.calls.size).toBe(3)
    Expect(pureFacts.some(fact => fact.node === chain.parameterList.parameters[0])).toBe(false)
    Expect(pureAnalysis.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })

    const reactiveFile = await parse(`
      type Token is text with {
        func Again() fails never -> Token { return Token }
        func Format() fails never -> text { return "token" }
      }
      func Build(Value Token) fails never -> Token { return Value }
      view Example {
        state Current is Token = Token "current"
        func Read() fails never -> text { return Build(Current).Again().Format() }
      }
    `)
    const reactiveToken = namedType(reactiveFile, 'Token')
    const view = reactiveFile.statements.find(AST.isViewDeclaration)
    Expect.Is(view, AST.isViewDeclaration)
    const state = AST.streamAllContents(view).find(value => AST.isStateDeclaration(value) && value.name === 'Current')
    Expect.Is(state, AST.isStateDeclaration)
    const read = namedFunction(reactiveFile, 'Read')
    const reactiveSnapshot = publishCanonicalEffectSnapshot([reactiveFile])
    const stateReference = AST.streamAllContents(read).find(value =>
      AST.isValueReference(value) && value.target.ref === state
    )
    Expect.Is(stateReference, AST.isValueReference)
    const reactiveCalls = AST.streamAllContents(read).filter(AST.isMethodCallExpression)
    const reactiveProjected = projectCallableEffectPublications(reactiveSnapshot, read)
    const reactiveFacts = discoverCallableEffectFacts(read, reactiveProjected.inputs, reactiveProjected.context)
    const reactiveAnalysis = analyzeCallableEffects(read, reactiveFacts)

    Expect(reactiveSnapshot.reads.get(stateReference)?.classification).toBe('reactive')
    Expect(reactiveCalls).toHaveLength(2)
    for (const call of reactiveCalls) {
      Expect.Is(call.callee, AST.isPostfixMemberAccess)
      const selection = reactiveProjected.inputs.reads.find(value => value.reference === call.callee)
      Assert.defined(selection, 'the reactive receiver call keeps its static selection read')
      const canonicalSelection = reactiveSnapshot.reads.get(call.callee)
      Assert.defined(canonicalSelection, 'the factory keeps the selection proof beside the reactive receiver')
      Expect(selection.classification).toBe('immutable')
      Assert(
        canonicalSelection.proof?.kind === 'static-method-selection',
        'the receiver does not weaken static selection',
      )
      Expect(canonicalSelection.proof.owner).toBe(reactiveToken)
      Expect(
        reactiveFacts.find(fact => fact.node === call.callee)?.executes.some(edge =>
          edge.target === call.callee.receiver
        ),
      ).toBe(true)
    }
    Expect(reactiveAnalysis.effects).toEqual({
      purity: { violations: ['reactive-state'], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('retains a genuine recursive backedge with one fact per source node', async () => {
    const file = await parse(`
      func Recurse(Value number) fails never -> number { return Recurse(Value) }
      func Entry(Value number) -> number { return Recurse(Value) }
    `)
    const recurse = namedFunction(file, 'Recurse')
    const entry = namedFunction(file, 'Entry')
    const recursiveSite = AST.returnStatementsOf(recurse)[0]?.value
    Expect.Is(recursiveSite, AST.isFunctionCallExpression)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, entry)
    const facts = discoverCallableEffectFacts(entry, projected.inputs, projected.context)
    const backedge = facts.find(fact => fact.node === recursiveSite)?.executes.find(edge => edge.target === recurse)

    Expect(facts.filter(fact => fact.node === recurse)).toHaveLength(1)
    Expect(facts.filter(fact => fact.node === recurse.block)).toHaveLength(1)
    Expect(backedge?.site).toBe(recursiveSite)
    Expect(backedge?.target).toBe(recurse)
    Expect(analyzeCallableEffects(entry, facts).effects.purity).toEqual({ violations: [], open: false })
    Expect(analyzeCallableEffects(entry, facts).effects.failures).toEqual({ cases: [], open: true })
  })

  Test('preserves unknown evaluation and invocation bridge phases at real source anchors', async () => {
    const file = await parse(`
      view Main {
        let Native is action(text) = OpenUrl from ./Native.ts
        action Root() { do Native("https://example.test") }
      }
    `)
    const alias = AST.streamAllContents(file).find(value => AST.isAliasDeclaration(value) && value.name === 'Native')
    const owner = AST.streamAllContents(file).find(value => AST.isActionDeclaration(value) && value.name === 'Root')
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(owner, AST.isActionDeclaration)
    Expect.Is(alias.value, AST.isFromExpression)
    const site = owner.block?.statements[0]
    Expect.Is(site, AST.isDoStatement)
    const exportSource = alias.value
    const native = (phase: NativeEffectPublication['phase'], declaration: AST.Node): NativeEffectPublication => ({
      phase,
      declaration,
      exportSource,
      kind: 'unknown',
      reason: 'unclassified-native',
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    const snapshot = publishCanonicalEffectSnapshot([file], {
      natives: [native('evaluation', exportSource), native('invocation', site)],
    })
    const projected = projectCallableEffectPublications(snapshot, owner)
    const facts = discoverCallableEffectFacts(owner, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(owner, facts)
    const phases = projected.inputs.natives.filter(value => value.exportSource === exportSource)

    Expect(phases.map(value => value.phase)).toEqual(['evaluation', 'invocation'])
    Expect(phases.every(value => value.kind === 'unknown' && value.reason === 'unclassified-native')).toBe(true)
    Expect(phases.every(value => value.exportSource === alias.value)).toBe(true)
    Expect(projected.inputs.calls.some(value => value.site === site)).toBe(false)
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
  })

  Test('retains real inherited parameter bindings and omits only independently excluded defaults', async () => {
    const file = await parse(`
      type Token is text with {
        func Format(Prefix text, Count number) fails never -> text {
          return Prefix
        }
      }
      type Child is Token
      func Show(Value Child) -> text { return Value.Format(2, "prefix") }
      func Read(Caption text? default "default") -> text { return "{Caption}" }
      func Omitted() -> text { return Read() }
      func Supplied() -> text { return Read(Caption: none) }
    `)
    const token = namedType(file, 'Token')
    const method = ownAssociatedMethods(token)[0]
    const show = namedFunction(file, 'Show')
    const read = namedFunction(file, 'Read')
    const omitted = namedFunction(file, 'Omitted')
    const supplied = namedFunction(file, 'Supplied')
    Assert.defined(method, 'the Token type has its source method')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const methodCall = [...snapshot.calls.values()].find(value => value.target === method)
    const readCalls = [...snapshot.calls.values()].filter(value => value.target === read)
    const omittedCall = readCalls.find(value => value.defaults.some(item => item.eligibility === 'may'))
    const suppliedCall = readCalls.find(value => value.defaults.some(item => item.eligibility === 'cannot'))
    Assert.defined(methodCall, 'the inherited associated call has a real canonical row')
    Assert.defined(omittedCall, 'the omitted call has a real canonical row')
    Assert.defined(suppliedCall, 'the supplied call has a real canonical row')

    const parameters = method.parameterList.parameters
    Expect(methodCall.pairs.find(pair => pair.parameter === parameters[0])?.argument).toBe(
      AST.argumentsOf(methodCall.site)[1],
    )
    Expect(methodCall.pairs.find(pair => pair.parameter === parameters[1])?.argument).toBe(
      AST.argumentsOf(methodCall.site)[0],
    )
    const defaultParameter = read.parameterList.parameters[0]
    Assert.defined(defaultParameter, 'Read declares its defaulted parameter')
    Expect(omittedCall.defaults.find(value => value.parameter === defaultParameter)?.expression).toBe(
      defaultParameter.defaultValue,
    )
    Expect(suppliedCall.defaults.find(value => value.parameter === defaultParameter)?.eligibility).toBe('cannot')

    const omittedProjection = projectCallableEffectPublications(snapshot, omitted)
    const suppliedProjection = projectCallableEffectPublications(snapshot, supplied)
    const omittedFacts = discoverCallableEffectFacts(omitted, omittedProjection.inputs, omittedProjection.context)
    const suppliedFacts = discoverCallableEffectFacts(supplied, suppliedProjection.inputs, suppliedProjection.context)
    const omittedEdge = omittedFacts.find(fact => fact.node === omittedCall.site)?.executes.find(edge =>
      edge.target === defaultParameter.defaultValue
    )
    const suppliedEdge = suppliedFacts.find(fact => fact.node === suppliedCall.site)?.executes.find(edge =>
      edge.target === defaultParameter.defaultValue
    )
    Expect(omittedEdge?.site).toBe(defaultParameter)
    Expect(suppliedEdge).toBeUndefined()
    const showProjection = projectCallableEffectPublications(snapshot, show)
    Expect(
      showProjection.inputs.calls.find(value => value.site === methodCall.site)?.pairs.find(pair =>
        pair.parameter === parameters[0]
      )?.argument,
    ).toBe(AST.argumentsOf(methodCall.site)[1])
  })

  Test('seeds an uncalled associated method default and excludes it for a supplied call', async () => {
    const file = await parse(`
      let Foreign is text = Read from ./Native.ts
      type Token is text with {
        func Format(Caption text default Foreign) fails never -> text { return Caption }
      }
      func Supplied(Value Token) fails never -> text { return Value.Format(Caption: "provided") }
    `)
    const foreign = file.statements.find(value => AST.isAliasDeclaration(value) && value.name === 'Foreign')
    const method = ownAssociatedMethods(namedType(file, 'Token'))[0]
    const supplied = namedFunction(file, 'Supplied')
    Expect.Is(foreign, AST.isAliasDeclaration)
    Assert.defined(method, 'the Token type declares Format')
    const parameter = method.parameterList.parameters[0]
    Assert.defined(parameter, 'Format declares its defaulted Caption parameter')
    const defaultValue = parameter.defaultValue
    Expect.Is(defaultValue, AST.isValueReference)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const methodProjection = projectCallableEffectPublications(snapshot, method)
    const methodFacts = discoverCallableEffectFacts(method, methodProjection.inputs, methodProjection.context)
    const methodAnalysis = analyzeCallableEffects(method, methodFacts)
    const rootDefault = methodProjection.context.root?.defaults.find(value => value.parameter === parameter)

    Assert.defined(rootDefault, 'the uncalled source root seeds Caption default execution')
    Expect(rootDefault.expression).toBe(defaultValue)
    Expect(methodFacts.some(fact => fact.node === defaultValue)).toBe(true)
    Expect(snapshot.reads.get(defaultValue)?.declaration).toBe(foreign)
    Expect(methodAnalysis.effects.purity.open).toBe(true)
    Expect(methodAnalysis.effects.failures.open).toBe(true)

    const suppliedProjection = projectCallableEffectPublications(snapshot, supplied)
    const suppliedFacts = discoverCallableEffectFacts(supplied, suppliedProjection.inputs, suppliedProjection.context)
    const call = suppliedProjection.inputs.calls.find(value => value.target === method)
    Assert.defined(call, 'Supplied has the real associated invocation')
    Expect(call.defaults.some(value => value.parameter === parameter)).toBe(false)
    Expect(suppliedFacts.some(fact => fact.executes.some(edge => edge.target === defaultValue))).toBe(false)
    Expect(analyzeCallableEffects(supplied, suppliedFacts).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('keeps known arguments and defaults while an unresolved binding opens the call', async () => {
    const file = await parse(
      `
      type Token is text with {
        func Format(Prefix text, Caption text default "default") fails never -> text { return Prefix }
      }
      func Broken(Value Token) -> text { return Value.Format(Prefix: Missing) }
    `,
      true,
    )
    const method = ownAssociatedMethods(namedType(file, 'Token'))[0]
    const broken = namedFunction(file, 'Broken')
    Assert.defined(method, 'the Token type has its source method')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const canonical = [...snapshot.calls.values()].find(value => value.target === method)
    Assert.defined(canonical, 'the unresolved associated call keeps its known target')
    const projected = projectCallableEffectPublications(snapshot, broken)
    const call = projected.inputs.calls.find(value => value.site === canonical.site)
    Assert.defined(call, 'the canonical call is projected')
    const facts = discoverCallableEffectFacts(broken, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(broken, facts)

    Expect(call.kind).toBe('unknown')
    Expect(call.pairs[0]?.argument).toBe(AST.argumentsOf(canonical.site)[0])
    Expect(call.defaults.some(value =>
      value.parameter === method.parameterList.parameters[1]
      && value.expression === method.parameterList.parameters[1]?.defaultValue
    )).toBe(true)
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
  })

  Test('leaves missing requirement evidence open and projects only its independently supplied contract', async () => {
    const file = await parse(`
      can Display { Format() fails never -> text }
      func Show(Value Display) -> text { return Value.Format() }
    `)
    const requirement = capabilityRequirements(namedType(file, 'Display'))[0]
    const show = namedFunction(file, 'Show')
    Assert.defined(requirement, 'Display declares its real Format requirement')
    const call = [...publishCanonicalEffectSnapshot([file]).calls.values()].find(value => value.target === requirement)
    Assert.defined(call, 'the requirement invocation is published')
    const withoutEvidence = publishCanonicalEffectSnapshot([file])
    const missingProjection = projectCallableEffectPublications(withoutEvidence, show)
    const missingFacts = discoverCallableEffectFacts(show, missingProjection.inputs, missingProjection.context)
    const missingAnalysis = analyzeCallableEffects(show, missingFacts)
    Expect(missingProjection.inputs.calls.find(value => value.site === call.site)?.kind).toBe('unknown')
    Expect(missingAnalysis.effects.purity.open).toBe(true)
    Expect(missingAnalysis.effects.failures.open).toBe(true)

    const contract = { purity: { violations: [], open: false }, failures: { cases: [], open: false } }
    const withEvidence = publishCanonicalEffectSnapshot([file], { requirements: new Map([[requirement, contract]]) })
    const evidenceProjection = projectCallableEffectPublications(withEvidence, show)
    const evidenceCall = evidenceProjection.inputs.calls.find(value => value.site === call.site)
    Assert.defined(evidenceCall, 'the actual requirement call keeps its source site')
    Expect(evidenceCall.contract).toEqual(contract)
    Expect(evidenceCall.body).toBeUndefined()
    Expect(evidenceCall.kind).toBe('complete')
    const evidenceFacts = discoverCallableEffectFacts(show, evidenceProjection.inputs, evidenceProjection.context)
    Expect(analyzeCallableEffects(show, evidenceFacts).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('rejects copied snapshot provenance and opens owners outside factory coverage', async () => {
    const indexed = await parse('func Indexed() -> text { return "indexed" }')
    const outside = await parse('func Outside() -> text { return "outside" }')
    const owner = namedFunction(outside, 'Outside')
    const snapshot = publishCanonicalEffectSnapshot([indexed])
    Expect(() => projectCallableEffectPublications({ ...snapshot }, owner)).toThrow(Errors.UnexpectedBehaviorError)

    const genuineProjection = projectCallableEffectPublications(snapshot, owner)
    const facts = discoverCallableEffectFacts(owner, genuineProjection.inputs, genuineProjection.context)
    const analysis = analyzeCallableEffects(owner, facts)
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
    Expect(facts.find(fact => fact.node === owner)?.reason).toBe('incomplete-fact')
  })
})

async function parse(source: string, allowUnresolved = false): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.length > 0).toBe(allowUnresolved)
  return parsed.entry.ast
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(value => AST.isTypeDeclaration(value) && value.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = AST.streamAllContents(file).find(value => AST.isFunctionDeclaration(value) && value.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}
