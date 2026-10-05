import { AST, Parser } from '@parser'
import { Assert, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  capabilityRequirements,
  ownAssociatedMethods,
  withAssociatedEffects,
} from '../ast-utils-src/associated-methods'
import { discoverCallableEffectFacts } from '../ast-utils-src/callable-effect-facts'
import {
  assertCanonicalEffectSnapshot,
  publishCanonicalEffectSnapshot,
} from '../ast-utils-src/canonical-effect-snapshot'

Describe('Canonical effect-independent source snapshot', () => {
  Test('publishes linked callable and read identities without analyzing source bodies', async () => {
    const file = await parse(`
      type Token is text with {
        func ToText() -> text { return "token" }
      }
      type Child is Token
      func Echo(Value text) -> text { return Value }
      func Show(Value Child) -> text { return Echo(Value.ToText()) }
    `)
    const token = namedType(file, 'Token')
    const method = ownAssociatedMethods(token)[0]
    Assert.defined(method, 'the Token fixture has its source method')
    const show = namedFunction(file, 'Show')
    const echo = namedFunction(file, 'Echo')
    const showParameter = show.parameterList.parameters[0]
    Assert.defined(showParameter, 'the Show receiver parameter exists')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const calls = [...snapshot.calls.values()]
    const methodCall = calls.find(call => AST.isMethodCallExpression(call.site))
    const ordinaryCall = calls.find(call => call.target === echo)
    Assert.defined(methodCall, 'the source method invocation is published')
    Assert.defined(ordinaryCall, 'the ordinary nested invocation is published')
    const methodDescriptor = snapshot.descriptors.get(method)
    const echoDescriptor = snapshot.descriptors.get(echo)
    const showDescriptor = snapshot.descriptors.get(show)
    Assert.defined(methodDescriptor, 'the associated source method has a descriptor')
    Assert.defined(echoDescriptor, 'the ordinary source function has a descriptor')
    Assert.defined(showDescriptor, 'the caller has a descriptor')

    Expect(snapshot.phase).toBe('correspondence')
    Expect(methodDescriptor.declaration).toBe(method)
    Expect(methodDescriptor.owner).toBe(token)
    Expect(methodDescriptor.body).toBe(method.block)
    Expect(methodDescriptor.kind).toBe('source')
    Expect(methodDescriptor.contract).toBeUndefined()
    Expect(methodCall.target).toBe(method)
    Expect(methodCall.descriptor).toBe(methodDescriptor)
    Expect(methodCall.receiver?.kind).toBe('member-path')
    if (methodCall.receiver?.kind === 'member-path') {
      Expect(methodCall.receiver.site.target.ref).toBe(showParameter)
    }
    Expect(ordinaryCall.target).toBe(echo)
    Expect(ordinaryCall.descriptor).toBe(echoDescriptor)
    Expect(echoDescriptor.body).toBe(echo.block)
    Expect(showDescriptor.body).toBe(show.block)
    const echoParameter = echo.parameterList.parameters[0]
    Expect(echoDescriptor.parameters[0]).toBe(echoParameter)
    const parameterRead = [...snapshot.reads.values()].find(read => read.declaration === echoParameter)
    Assert.defined(parameterRead, 'the ordinary parameter read is published')
    Expect(parameterRead.classification).toBe('immutable')
    Expect(parameterRead.proof?.kind).toBe('parameter')
    Expect(parameterRead.proof?.owner).toBe(echo)
    assertCanonicalEffectSnapshot(snapshot)
  })

  Test('distinguishes omitted defaults from explicitly provided wrapped none', async () => {
    const file = await parse(`
      func Read(Suffix text? default "fallback") -> text { return "{Suffix}" }
      func Empty() -> text { return Read() }
      func Provided() -> text { return Read(Suffix: none) }
    `)
    const read = namedFunction(file, 'Read')
    const parameter = read.parameterList.parameters[0]
    Assert.defined(parameter, 'the optional source parameter exists')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const calls = [...snapshot.calls.values()].filter(call => call.target === read)
    const empty = calls.find(call => call.pairs.length === 0)
    const provided = calls.find(call => call.pairs.length > 0)
    Assert.defined(empty, 'the omitted call is published')
    Assert.defined(provided, 'the explicitly provided wrapped none call is published')

    Expect(empty.kind).toBe('complete')
    Expect(provided.kind).toBe('complete')
    Expect(empty.defaults).toHaveLength(1)
    Expect(provided.defaults).toHaveLength(1)
    Expect(empty.defaults[0]?.parameter).toBe(parameter)
    Expect(empty.defaults[0]?.expression).toBe(parameter.defaultValue)
    Expect(empty.defaults[0]?.eligibility).toBe('may')
    Expect(empty.defaults[0]?.reason).toBe('omitted')
    Expect(provided.defaults[0]?.parameter).toBe(parameter)
    Expect(provided.defaults[0]?.expression).toBe(parameter.defaultValue)
    Expect(provided.defaults[0]?.eligibility).toBe('cannot')
    Expect(provided.defaults[0]?.reason).toBe('provided-wrapper')
  })

  Test('keeps unresolved argument correspondence unknown while retaining the linked target', async () => {
    const file = await parse(
      `
      func Read(Suffix text? default "fallback") -> text { return "{Suffix}" }
      func Broken() -> text { return Read(Suffix: Missing) }
    `,
      true,
    )
    const read = namedFunction(file, 'Read')
    const call = [...publishCanonicalEffectSnapshot([file]).calls.values()].find(value => value.target === read)
    Assert.defined(call, 'the unresolved call is retained in the snapshot')
    Expect(call.kind).toBe('unknown')
    Expect(call.reason).toBe('incomplete-fact')
    Expect(call.target).toBe(read)
    Expect(call.defaults[0]?.parameter).toBe(read.parameterList.parameters[0])
    Expect(call.defaults[0]?.expression).toBe(read.parameterList.parameters[0]?.defaultValue)
    Expect(call.defaults[0]?.eligibility).toBe('unknown')
    Expect(call.defaults[0]?.reason).toBe('unresolved-binding')
    Expect.Is(call.site, AST.isFunctionCallExpression)
    Expect(call.site).toBe(AST.returnStatementsOf(namedFunction(file, 'Broken'))[0]?.value)
    const missing = AST.argumentsOf(call.site)[0]?.value
    Expect.Is(missing, AST.isValueReference)
    Expect(missing.target.ref).toBeUndefined()
  })

  Test('retains each linked alias declaration and initializer without executing the inferred body', async () => {
    const file = await parse(`
      let Original = "original"
      let First = Original
      let Second = First
      func Read() -> text { return Second }
    `)
    const aliases = file.statements.filter(AST.isAliasDeclaration)
    const [original, first, second] = aliases
    Assert.defined(original, 'the source literal alias exists')
    Assert.defined(first, 'the first alias exists')
    Assert.defined(second, 'the second alias exists')
    const read = namedFunction(file, 'Read')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const firstRead = snapshot.reads.get(first.value)
    const secondRead = snapshot.reads.get(second.value)
    Assert.defined(firstRead, 'the first alias reference is published')
    Assert.defined(secondRead, 'the second alias reference is published')
    Expect(firstRead.declaration).toBe(original)
    Expect(firstRead.initializer).toBe(original.value)
    Expect(firstRead.proof?.owner).toBe(original)
    Expect(secondRead.declaration).toBe(first)
    Expect(secondRead.initializer).toBe(first.value)
    Expect(secondRead.proof?.owner).toBe(first)
    Expect(snapshot.descriptors.get(read)?.body).toBe(read.block)
    Expect(snapshot.descriptors.get(read)?.pending).toEqual([])
  })

  Test('classifies immutable and mutable parameters, contextual owners, and live state references', async () => {
    const file = await parse(`
      type Record is { Value text }
      type Token is text with { func ToText() -> text { return Token } }
      func Pass(Value Record) -> Record { return Value }
      view Example {
        state Counter = 1
        let Live = Counter
        func Read(Value text, mutable Draft text) -> text { return "{Value}:{Draft}" }
      }
    `)
    const token = namedType(file, 'Token')
    const tokenMethod = ownAssociatedMethods(token)[0]
    Assert.defined(tokenMethod, 'Token has its contextual method')
    const contextualReference = AST.streamAllContents(tokenMethod).find(AST.isValueReference)
    Expect.Is(contextualReference, AST.isValueReference)
    const readFunction = namedFunction(file, 'Read')
    const [value, draft] = readFunction.parameterList.parameters
    Assert.defined(value, 'the ordinary immutable parameter exists')
    Assert.defined(draft, 'the mutable parameter exists')
    const view = file.statements.find(AST.isViewDeclaration)
    Expect.Is(view, AST.isViewDeclaration)
    const state = AST.streamAllContents(view).find(AST.isStateDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const contextual = snapshot.reads.get(contextualReference)
    const valueRead = [...snapshot.reads.values()].find(read => read.declaration === value)
    const draftRead = [...snapshot.reads.values()].find(read => read.declaration === draft)
    const liveStateRead = [...snapshot.reads.values()].find(read => read.declaration === state)
    const recordValue = namedFunction(file, 'Pass').parameterList.parameters[0]
    Assert.defined(recordValue, 'the item-typed parameter exists')
    const itemRead = [...snapshot.reads.values()].find(read => read.declaration === recordValue)
    Assert.defined(contextual, 'the contextual owner member read is published')
    Assert.defined(valueRead, 'the immutable parameter read is published')
    Assert.defined(draftRead, 'the mutable parameter read is published')
    Assert.defined(liveStateRead, 'the state initializer read is published')
    Assert.defined(itemRead, 'the item-typed parameter read is published')

    Expect(contextual.classification).toBe('immutable')
    Expect(contextual.proof?.kind).toBe('contextual-owner')
    Expect(contextual.proof?.owner).toBe(token)
    Expect(valueRead.classification).toBe('immutable')
    Expect(draftRead.classification).toBe('reactive')
    Expect(liveStateRead.classification).toBe('reactive')
    Expect(liveStateRead.proof?.kind).toBe('state')
    Expect(liveStateRead.proof?.owner).toBe(state)
    Expect(itemRead.classification).toBe('unknown')
  })

  Test('keeps failure bounds separate from real source correspondence', async () => {
    const file = await parse(`
      type Token is text with {
        func ToText() -> text { return "token" }
      }
      can Display { ToText() fails never -> text }
      func Consume(Value Display) -> text { return Value.ToText() }
      func Entry(Value Token) -> text { return Consume(Value) }
    `)
    const consume = namedFunction(file, 'Consume')
    const entry = namedFunction(file, 'Entry')
    const tokenMethod = ownAssociatedMethods(namedType(file, 'Token'))[0]
    const requiredMethod = capabilityRequirements(namedType(file, 'Display'))[0]
    Assert.defined(tokenMethod, 'Token has the concrete method')
    Assert.defined(requiredMethod, 'Display has the method requirement')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const calls = [...snapshot.calls.values()]
    const method = calls.find(call => AST.isMethodCallExpression(call.site))
    const ordinary = calls.find(call => call.target === consume)
    Assert.defined(method, 'the capability method call is published')
    Assert.defined(ordinary, 'the ordinary function call is published')

    Expect(method.kind).toBe('complete')
    Expect(ordinary.kind).toBe('complete')
    Expect(snapshot.descriptors.get(consume)?.signature?.failures).toEqual({ cases: [], open: true })
    Expect(snapshot.descriptors.get(entry)?.signature?.failures).toEqual({ cases: [], open: true })
    Expect(method.target).toBeDefined()
    Expect(method.target).toBe(requiredMethod)
    Expect(snapshot.descriptors.get(tokenMethod)?.signature?.failures).toEqual({ cases: [], open: true })
    Expect(snapshot.descriptors.get(requiredMethod)?.kind).toBe('requirement')
    Expect(ordinary.target).toBe(consume)
    Expect(snapshot.descriptors.get(consume)?.contract).toBeUndefined()
  })

  Test('leaves recursive inferred associated calls pending instead of choosing an inherited method', async () => {
    const file = await parse(`
      type Token is text with {
        func ToText() -> text { return "token" }
      }
      type Child is Token with {
        func ToText(Suffix text default "fallback") { return Child.ToText() }
      }
      func Entry(Value Child) { return Value.ToText() }
    `)
    const child = namedType(file, 'Child')
    const method = ownAssociatedMethods(child)[0]
    Assert.defined(method, 'Child declares the nearest recursive method')
    const entry = namedFunction(file, 'Entry')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const descriptor = snapshot.descriptors.get(method)
    const call = [...snapshot.calls.values()].find(value => value.site.$cstNode?.text?.includes('Value.ToText'))
    Assert.defined(descriptor, 'the recursive source method has a descriptor')
    Assert.defined(call, 'the call through Child is retained')

    Expect(snapshot.associatedDescriptors.get(method)?.kind).toBe('pending')
    Expect(descriptor.pending).toContain(method)
    Expect(call.kind).toBe('unknown')
    Expect(call.target).toBe(method)
    Expect(call.descriptor).toBe(descriptor)
    Expect(descriptor.owner).toBe(child)
    Expect(call.defaults[0]?.parameter).toBe(method.parameterList.parameters[0])
    Expect(call.defaults[0]?.expression).toBe(method.parameterList.parameters[0]?.defaultValue)
    Expect(call.defaults[0]?.eligibility).toBe('unknown')
    Expect(snapshot.descriptors.get(entry)?.body).toBe(entry.block)
  })

  Test('owns evidence and exposes immutable snapshot views only before admission', async () => {
    const file = await parse(`
      can Display { ToText() -> text }
      func Echo() -> text { return "entry" }
      func Entry() -> text { return Echo() }
    `)
    const requirement = namedType(file, 'Display')
    const method = capabilityRequirements(requirement)[0]
    Assert.defined(method, 'the capability fixture has a method requirement')
    const contract = { purity: { violations: [], open: false }, failures: { cases: [], open: false } }
    const requirements = new Map([[method, contract]])
    const evidence = { requirements }
    const files = [file]
    const snapshot = publishCanonicalEffectSnapshot(files, evidence)
    requirements.clear()
    files.length = 0

    Expect(snapshot.roots).toHaveLength(1)
    Expect(snapshot.roots[0]).toBe(file)
    Expect(snapshot.natives).toEqual([])
    Expect(snapshot.descriptors.get(method)?.contract).toEqual(contract)
    Expect('set' in snapshot.calls).toBe(false)
    Expect('clear' in snapshot.calls).toBe(false)
    let forEachView: unknown
    snapshot.calls.forEach((_value, _key, map) => {
      forEachView = map
    })
    Expect(forEachView).toBe(snapshot.calls)
    Expect(Object.isFrozen(file)).toBe(false)
    Expect(() => assertCanonicalEffectSnapshot({ ...snapshot })).toThrow(Errors.UnexpectedBehaviorError)
    Expect(() =>
      withAssociatedEffects(
        { descriptors: new Map(), analyses: new Map() },
        () => publishCanonicalEffectSnapshot([file]),
      )
    ).toThrow(Errors.UnexpectedBehaviorError)
  })
  Test('seals item and derived slot metadata while retaining editable source witnesses', async () => {
    const file = await parse(`
      type Entry is { Label text }
      type Token is text with { Caption text }
      func Keep(Value Entry) -> Entry { return Value }
      func Text(Value Token) -> Token { return Value }
    `)
    const entry = namedType(file, 'Entry')
    const token = namedType(file, 'Token')
    Expect.Is(entry.type, AST.isItemTypeExpression)
    Expect.Is(token.type, AST.isDerivedTypeExpression)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const item = snapshot.descriptors.get(namedFunction(file, 'Keep'))?.result
    const text = snapshot.descriptors.get(namedFunction(file, 'Text'))?.result
    Assert(item?.kind === 'item' && item.item, 'the parsed item result retains its published fields')
    Assert(
      text?.kind === 'primitive' && text.primitive === 'text' && text.slots,
      'the derived text result retains its slots',
    )
    Expect(item.item).not.toBe(entry.type)
    Expect(item.item.properties).not.toBe(entry.type.properties)
    Expect(item.item.properties[0]).toBe(entry.type.properties[0])
    Expect(text.slots.properties[0]).toBe(token.type.slots.properties[0])
    Expect(Object.isFrozen(item.item)).toBe(true)
    Expect(Object.isFrozen(item.item.properties)).toBe(true)
    Expect(Object.isFrozen(text.slots)).toBe(true)
    Expect(Object.isFrozen(text.slots.properties)).toBe(true)
    Expect(Object.isFrozen(entry.type)).toBe(false)
    Expect(Object.isFrozen(entry.type.properties)).toBe(false)
    Expect(Object.isFrozen(token.type.slots.properties[0])).toBe(false)
    entry.type.properties.length = 0
    token.type.slots.properties.length = 0
    Expect(item.item.properties).toHaveLength(1)
    Expect(text.slots.properties).toHaveLength(1)
  })

  Test('keeps a pending capability competitor from manufacturing unique binding or unused defaults', async () => {
    const file = await parse(`
      type Base is text
      type Token is Base with { func ToText() { return Token.ToText() } }
      can Display { ToText() -> text }
      func Take(Value Base, Shown Display, Suffix text default "fallback") -> text { return Suffix }
      func Entry(Value Token) -> text { return Take(Value) }
    `)
    const take = namedFunction(file, 'Take')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const call = [...snapshot.calls.values()].find(call => call.target === take)
    Assert.defined(call, 'the actual call with a pending competing capability is inventoried')
    Expect(call.kind).toBe('unknown')
    Expect(call.diagnostics.some(diagnostic => diagnostic.kind === 'ambiguous-argument')).toBe(true)
    Expect(call.pairs).toHaveLength(0)
    Expect(call.defaults[0]?.parameter).toBe(AST.parametersOf(take)[2])
    Expect(call.defaults[0]?.eligibility).toBe('unknown')
  })

  Test('publishes static selection reads separately from real chained method calls and receiver reads', async () => {
    const file = await parse(`
      type Token is text with {
        func Again() -> Token { return Token "again" }
        func Format(Suffix text default "fallback") -> text { return Suffix }
      }
      func Build(Value Token) -> Token { return Value }
      func Chain(Value Token) -> text { return Build(Value).Again().Format(Suffix: true) }
    `)
    const token = namedType(file, 'Token')
    const again = ownAssociatedMethods(token).find(method => method.name === 'Again')
    const format = ownAssociatedMethods(token).find(method => method.name === 'Format')
    const build = namedFunction(file, 'Build')
    const chain = namedFunction(file, 'Chain')
    Assert.defined(again, 'Token declares the selected Again method')
    Assert.defined(format, 'Token declares the selected Format method')
    const parameter = AST.parametersOf(chain)[0]
    Assert.defined(parameter, 'Chain has its real receiver input')
    const calls = AST.streamAllContents(chain).filter(AST.isMethodCallExpression)
    const againCall = calls.find(call => AST.isPostfixMemberAccess(call.callee) && call.callee.member === 'Again')
    const formatCall = calls.find(call => AST.isPostfixMemberAccess(call.callee) && call.callee.member === 'Format')
    Assert.defined(againCall, 'the actual chained Again invocation exists')
    Assert.defined(formatCall, 'the actual chained Format invocation exists')
    Expect.Is(againCall.callee, AST.isPostfixMemberAccess)
    Expect.Is(formatCall.callee, AST.isPostfixMemberAccess)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const againRead = snapshot.reads.get(againCall.callee)
    const formatRead = snapshot.reads.get(formatCall.callee)
    Assert.defined(againRead, 'the actual Again callee has a selection read')
    Assert.defined(formatRead, 'the actual Format callee has a selection read')
    for (
      const [read, declaration, call] of [
        [againRead, again, againCall],
        [formatRead, format, formatCall],
      ] as const
    ) {
      Expect(read.classification).toBe('immutable')
      Assert(read.proof?.kind === 'static-method-selection', 'the selection has its independent static proof')
      Expect.Is(call.callee, AST.isPostfixMemberAccess)
      const callee = call.callee
      Expect(read.proof.owner).toBe(token)
      Expect(read.proof.declaration).toBe(declaration)
      Expect(read.proof.receiver).toBe(call.callee.receiver)
      const facts = discoverCallableEffectFacts(call.callee, {
        calls: [],
        reads: [...snapshot.reads.values()],
        natives: [],
      })
      const selection = facts.find(fact => fact.node === call.callee)
      Assert.defined(selection, 'the consumer discovers the actual static callee')
      Expect(selection.kind).toBe('complete')
      Expect(selection.executes.some(edge => edge.target === callee.receiver)).toBe(true)
      const publication = snapshot.calls.get(call)
      Assert.defined(publication, 'the snapshot retains the actual method call site')
      Expect(publication.site).toBe(call)
      Expect(publication.target).toBe(declaration)
    }
    const formatPublication = snapshot.calls.get(formatCall)
    Assert.defined(formatPublication, 'the actual Format call remains published')
    Expect(formatPublication.kind).toBe('unknown')
    const valueReads = [...snapshot.reads.values()].filter(read => read.declaration === parameter)
    Expect(valueReads.length).toBeGreaterThan(0)
    Expect(valueReads.every(read => read.classification === 'immutable')).toBe(true)
    Expect(snapshot.descriptors.get(build)?.declaration).toBe(build)
    const pendingFile = await parse(`
      type Token is text with {
        func Again(Suffix text default "fallback") { return Token.Again() }
      }
      func Build(Value Token) -> Token { return Value }
      func Read(Value Token) { return Build(Value).Again() }
    `)
    const pendingToken = namedType(pendingFile, 'Token')
    const pendingMethod = ownAssociatedMethods(pendingToken)[0]
    Assert.defined(pendingMethod, 'the pending recursive method declaration exists')
    const pendingCall = AST.streamAllContents(namedFunction(pendingFile, 'Read'))
      .find(AST.isMethodCallExpression)
    Expect.Is(pendingCall, AST.isMethodCallExpression)
    Expect.Is(pendingCall.callee, AST.isPostfixMemberAccess)
    const pendingSnapshot = publishCanonicalEffectSnapshot([pendingFile])
    const pendingRead = pendingSnapshot.reads.get(pendingCall.callee)
    Assert.defined(pendingRead, 'the pending method has a static selection read')
    Expect(pendingRead.declaration).toBe(pendingMethod)
    Expect(pendingRead.classification).toBe('unknown')
    Expect(pendingSnapshot.calls.get(pendingCall)?.kind).toBe('unknown')
  })

  Test('keeps static selection immutable while preserving a reactive state receiver edge', async () => {
    const file = await parse(`
      type Token is text with {
        func Again() -> Token { return Token "again" }
        func Format() -> text { return "formatted" }
      }
      func Build(Value Token) -> Token { return Value }
      view Example {
        state Current is Token = Token "current"
        let Output = Build(Current).Again().Format()
      }
    `)
    const token = namedType(file, 'Token')
    const view = file.statements.find(AST.isViewDeclaration)
    Expect.Is(view, AST.isViewDeclaration)
    const state = AST.streamAllContents(view).find(AST.isStateDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    const calls = AST.streamAllContents(view).filter(AST.isMethodCallExpression)
    const againCall = calls.find(call => AST.isPostfixMemberAccess(call.callee) && call.callee.member === 'Again')
    const formatCall = calls.find(call => AST.isPostfixMemberAccess(call.callee) && call.callee.member === 'Format')
    Assert.defined(againCall, 'the state receiver invokes Again')
    Assert.defined(formatCall, 'the returned Token invokes Format')
    Expect.Is(againCall.callee, AST.isPostfixMemberAccess)
    Expect.Is(formatCall.callee, AST.isPostfixMemberAccess)
    const stateReference = AST.streamAllContents(view).find(node =>
      AST.isValueReference(node) && node.target.ref === state
    )
    Expect.Is(stateReference, AST.isValueReference)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const stateRead = snapshot.reads.get(stateReference)
    const againSelection = snapshot.reads.get(againCall.callee)
    const formatSelection = snapshot.reads.get(formatCall.callee)
    Assert.defined(stateRead, 'the real Current reference remains in the read graph')
    Assert.defined(againSelection, 'the Again selection has a snapshot read')
    Assert.defined(formatSelection, 'the Format selection has a snapshot read')
    Expect(stateRead.declaration).toBe(state)
    Expect(stateRead.classification).toBe('reactive')
    Expect(stateRead.proof?.kind).toBe('state')
    for (const [read, call] of [[againSelection, againCall], [formatSelection, formatCall]] as const) {
      Expect(read.classification).toBe('immutable')
      Assert(
        read.proof?.kind === 'static-method-selection',
        'the state-backed receiver has an independent selection proof',
      )
      Expect.Is(call.callee, AST.isPostfixMemberAccess)
      Expect(read.proof.owner).toBe(token)
      Expect(read.proof.receiver).toBe(call.callee.receiver)
      Expect(snapshot.calls.get(call)?.site).toBe(call)
    }
  })
})

async function parse(source: string, allowUnresolved = false): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.length > 0).toBe(allowUnresolved)
  if (!allowUnresolved) {
    Expect(parsed.diagnostics).toEqual([])
  }
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
