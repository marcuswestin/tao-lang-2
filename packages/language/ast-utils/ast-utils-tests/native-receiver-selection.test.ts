import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { ownAssociatedMethods } from '../ast-utils-src/associated-methods'
import type { NativeEffectPublication } from '../ast-utils-src/callable-effect-facts'
import { discoverCallableEffectFacts } from '../ast-utils-src/callable-effect-facts'
import { projectCallableEffectPublications } from '../ast-utils-src/callable-effect-publications'
import { analyzeCallableEffects } from '../ast-utils-src/callable-effects'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'

Describe('Native associated receiver selection', () => {
  Test('publishes real item-owner forwarding and direct static and parameter method selections', async () => {
    const file = await parse(`
      type Timer is {
        Elapsed number
        func Duration() -> number { return SampleDuration(Timer) from ./Durations.ts }
      }
      type Time is {
        static func StartTimer() -> Timer { return StartTimer() from ./Durations.ts }
      }
      func Start() -> Timer { return Time.StartTimer() }
      func Sample(Value Timer) -> number { return Value.Duration() }
    `)
    const timer = namedType(file, 'Timer')
    const time = namedType(file, 'Time')
    const duration = method(timer, 'Duration')
    const startTimer = method(time, 'StartTimer')
    const start = namedFunction(file, 'Start')
    const sample = namedFunction(file, 'Sample')
    const snapshot = publishCanonicalEffectSnapshot([file], { natives: nativeHeads(file) })
    const forwarding = AST.streamAllContents(duration).find(AST.isValueReference)
    Expect.Is(forwarding, AST.isValueReference)
    Expect(forwarding.target.ref).toBe(timer)
    Expect(AST.associatedReceiverOwner(forwarding)).toBe(timer)
    Expect(snapshot.reads.get(forwarding)?.classification).toBe('immutable')
    Expect(snapshot.reads.get(forwarding)?.proof?.kind).toBe('contextual-owner')
    Expect(snapshot.reads.get(forwarding)?.proof?.owner).toBe(timer)
    for (const [caller, selected, owner] of [[start, startTimer, time], [sample, duration, timer]] as const) {
      const call = AST.streamAllContents(caller).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      Expect.Is(call.callee, AST.isMemberAccessExpression)
      const publication = snapshot.calls.get(call)
      const read = snapshot.reads.get(call.callee)
      Assert.defined(publication, 'the real associated call is published')
      Assert.defined(read, 'the named callee is published')
      Expect(publication.kind).toBe('complete')
      Expect(publication.target).toBe(selected)
      Expect(publication.descriptor?.body).toBe(selected.block)
      Expect(read.classification).toBe('immutable')
      Assert(read.proof?.kind === 'named-method-selection', 'the named callee retains selection evidence')
      Expect(read.proof.owner).toBe(owner)
      Expect(read.proof.declaration).toBe(selected)
      Expect(read.proof.receiver).toBe(publication.receiver)
      Assert(read.proof.receiver.kind === 'member-path', 'the real named receiver is a member path')
      Expect(read.proof.receiver.site).toBe(call.callee)
      Expect(read.proof.receiver.members).toEqual([])
    }
    const registered = createAssociatedEffects([file])
    for (const declaration of [start, sample, duration, startTimer]) {
      const analysis = registered.analyses.get(declaration)
      Assert.defined(analysis, 'the actual callable is analyzed')
      Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
      Expect(analysis.effects.failures.open).toBe(true)
    }
  })

  Test('requires a complete pure foreign-head witness for contextual item transport', async () => {
    const file = await parse(`
      type Timer is {
        Elapsed number
        func Duration() -> number { return SampleDuration(Timer) from ./Durations.ts }
      }
    `)
    const duration = method(namedType(file, 'Timer'), 'Duration')
    const reference = AST.streamAllContents(duration).find(AST.isValueReference)
    Expect.Is(reference, AST.isValueReference)
    const native = nativeHeads(file)[0]
    Assert.defined(native, 'the genuine native head exists')
    const rejected: readonly (readonly NativeEffectPublication[])[] = [
      [],
      [{ ...native, kind: 'unknown', reason: 'unclassified-native' }],
      [{ ...native, purity: { violations: ['io'], open: false } }],
      [{ ...native, purity: { violations: [], open: true } }],
      [{ ...native, phase: 'invocation' }],
      [{ ...native, exportSource: duration }],
    ]
    for (const natives of rejected) {
      const read = publishCanonicalEffectSnapshot([file], { natives }).reads.get(reference)
      Assert.defined(read, 'the contextual read remains published without transport evidence')
      Expect(read.classification).toBe('unknown')
      Expect(read.proof).toBeUndefined()
    }
  })

  Test('does not transport member reads, nested arguments, static type roots or another owner', async () => {
    const file = await parse(
      `
      type Other is { Elapsed number }
      type Timer is {
        Elapsed number
        func Member() -> number { return SampleDuration(Timer.Elapsed) from ./Durations.ts }
        func Nested() -> number { return SampleDuration(Identity(Timer)) from ./Durations.ts }
        static func Static() -> number { return SampleDuration(Timer) from ./Durations.ts }
        func Wrong(Other Other) -> number { return SampleDuration(Other) from ./Durations.ts }
      }
      func Identity(Value Timer) -> Timer { return Value }
    `,
      true,
    )
    const timer = namedType(file, 'Timer')
    const snapshot = publishCanonicalEffectSnapshot([file], { natives: nativeHeads(file) })
    for (const name of ['Member', 'Nested', 'Static', 'Wrong']) {
      const declaration = method(timer, name)
      const reference = AST.streamAllContents(declaration).find(node =>
        AST.isValueReference(node) || AST.isMemberAccessExpression(node)
      )
      Assert.defined(reference, 'the rejected forwarding shape has a real reference')
      const read = snapshot.reads.get(reference)
      Assert.defined(read, 'the rejected forwarding read remains published')
      Expect(read.classification).toBe('unknown')
      Expect(read.proof?.kind).not.toBe('contextual-owner')
    }
  })

  Test('keeps named state, mutable, copy, alias and longer receiver paths under ordinary read evidence', async () => {
    const file = await parse(`
      type Timer is { Elapsed number func Duration() -> number { return 1 } }
      type Holder is { Clock Timer }
      func Mutable(mutable Value Timer) -> number { return Value.Duration() }
      func Copy(copy Value Timer) -> number { return Value.Duration() }
      func Nested(Value Holder) -> number { return Value.Clock.Duration() }
      let AliasClock is Timer = Timer { Elapsed: 1 }
      func Alias() -> number { return AliasClock.Duration() }
      view Example {
        state Clock is Timer = Timer { Elapsed: 1 }
        let Sample = Clock.Duration()
      }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (
      const [name, classification] of [
        ['Mutable', 'reactive'],
        ['Copy', 'reactive'],
        ['Nested', 'unknown'],
        ['Alias', 'immutable'],
      ] as const
    ) {
      const call = AST.streamAllContents(namedFunction(file, name)).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      const read = snapshot.reads.get(call.callee)
      Assert.defined(read, 'the direct callee has its ordinary read evidence')
      Expect(read.classification).toBe(classification)
      Expect(read.proof?.kind).not.toBe('named-method-selection')
      if (name === 'Alias') {
        Assert(AST.isMemberAccessExpression(call.callee), 'the alias callee has its named root')
        const alias = call.callee.target.ref
        Expect.Is(alias, AST.isAliasDeclaration)
        Expect(read.initializer).toBe(alias.value)
      }
    }
    const state = AST.streamAllContents(file).find(AST.isStateDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    const read = [...snapshot.reads.values()].find(value => value.declaration === state)
    Assert.defined(read, 'the state receiver has a read publication')
    Expect(read.classification).toBe('reactive')
    Expect(read.proof?.kind).toBe('state')
  })

  Test('leaves pending and missing methods unknown and executes a selected impure source body', async () => {
    const file = await parse(
      `
      let Host is number = Read from ./Native.ts
      type Timer is {
        Elapsed number
        func Pending() { return Timer.Pending() }
        func Impure() -> number { return Host }
      }
      func Pending(Value Timer) { return Value.Pending() }
      func Missing(Value Timer) { return Value.Missing() }
      func Impure(Value Timer) -> number { return Value.Impure() }
    `,
      true,
    )
    const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
    Expect.Is(bridge, AST.isFromExpression)
    const snapshot = publishCanonicalEffectSnapshot([file], {
      natives: [{
        declaration: bridge.expression,
        exportSource: bridge.expression,
        phase: 'evaluation',
        kind: 'complete',
        purity: { violations: ['io'], open: false },
        failures: { cases: [], open: false },
      }],
    })
    for (const name of ['Pending', 'Missing']) {
      const call = AST.streamAllContents(namedFunction(file, name)).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      Expect(snapshot.calls.get(call)?.kind).toBe('unknown')
      Expect(snapshot.reads.get(call.callee)?.classification).toBe('unknown')
      Expect(snapshot.reads.get(call.callee)?.proof?.kind).not.toBe('named-method-selection')
    }
    const impure = namedFunction(file, 'Impure')
    const selected = method(namedType(file, 'Timer'), 'Impure')
    const call = AST.streamAllContents(impure).find(AST.isMethodCallExpression)
    Expect.Is(call, AST.isMethodCallExpression)
    Expect(snapshot.calls.get(call)?.target).toBe(selected)
    Expect(snapshot.calls.get(call)?.descriptor?.body).toBe(selected.block)
    Expect(snapshot.reads.get(call.callee)?.classification).toBe('immutable')
    for (const declaration of [selected, impure]) {
      const publication = projectCallableEffectPublications(snapshot, declaration)
      const facts = discoverCallableEffectFacts(declaration, publication.inputs, publication.context)
      Expect(analyzeCallableEffects(declaration, facts).effects.purity.violations).toContain('io')
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

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}

function method(owner: AST.TypeDeclaration, name: string): AST.AssociatedFunctionDeclaration {
  const declaration = ownAssociatedMethods(owner).find(node => node.name === name)
  Assert.defined(declaration, 'the fixture declares its selected method')
  return declaration
}

function nativeHeads(file: AST.TaoFile): NativeEffectPublication[] {
  return AST.streamAllContents(file).filter(AST.isFromExpression).map(bridge => {
    Expect.Is(bridge.expression, AST.isFunctionCallExpression)
    return {
      declaration: bridge.expression,
      exportSource: bridge.expression,
      phase: 'evaluation',
      kind: 'complete',
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    }
  })
}
