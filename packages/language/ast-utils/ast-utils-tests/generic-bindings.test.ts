import { ASTUtils, Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { resolveAssociatedMethodInvocation } from '../ast-utils-src/associated-invocations'
import { analyzeCallableEffects } from '../ast-utils-src/callable-effects'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'

const contracts = `
  can Comparable { Compare(Other Self) fails never -> boolean }
  can Display { ToText() fails never -> text }
  type Celsius is number with {
    func Compare(Other Self) fails never -> boolean { return true }
    func ToText() fails never -> text { return "temperature" }
  }
  type RoomReading is Celsius
  type Fahrenheit is number with {
    func Compare(Other type) fails never -> boolean { return true }
    func ToText() fails never -> text { return "temperature" }
  }
  func Earlier where type T is Comparable and Display (Left T, Right T) -> T { return Left }
  func Inspect where type T is Comparable and Display (Value T) -> text { return Value.ToText() }
`

Describe('bounded generic invocation domains', () => {
  Test('specializes an inherited associated generic Self bound to the actual child receiver', async () => {
    const file = await parse(`
      type Parent is number with {
        func Keep where type T is Self (Value T) -> T { return Value }
      }
      type Child is Parent
      func Good(Receiver Child, ChildValue Child) -> Child { return Receiver.Keep(Value: ChildValue) }
      func Bad(Receiver Child, ParentValue Parent) -> Parent { return Receiver.Keep(Value: ParentValue) }
    `)
    const parent = namedType(file, 'Parent')
    const method = ASTUtils.ownAssociatedMethods(parent)[0]!
    const parameter = method.parameterList.parameters[0]!
    const goodCall = AST.returnStatementsOf(namedFunction(file, 'Good'))[0]!.value
    const badCall = AST.returnStatementsOf(namedFunction(file, 'Bad'))[0]!.value
    Expect.Is(goodCall, AST.isMethodCallExpression)
    Expect.Is(badCall, AST.isMethodCallExpression)
    withEvidence(file, () => {
      const good = resolveAssociatedMethodInvocation(goodCall)
      Expect(good.problem).toBeUndefined()
      Expect(good.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(good.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(good.descriptor?.owner).toBe(parent)
      Expect(good.descriptor?.declaration).toBe(method)
      Expect(Type.displayName(good.receiver!)).toBe('Child')
      Expect(Type.displayName(good.parameterTypes!.get(parameter)!)).toBe('Child')
      Expect(Type.displayName(good.descriptor!.signature.inputs[0]!.type)).toBe('Child')
      Expect(Type.displayName(good.descriptor!.result)).toBe('Child')
      Expect(Type.displayName(Type.ofExpression(goodCall))).toBe('Child')
      const bad = resolveAssociatedMethodInvocation(badCall)
      Expect(bad.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual(['incompatible-generic'])
      Expect(bad.parameterTypes!.get(parameter)!.kind).toBe('unresolved')
      Expect(bad.descriptor?.result.kind).toBe('unresolved')
      Expect(Type.ofExpression(badCall).kind).toBe('unresolved')
    })
    const snapshot = publishCanonicalEffectSnapshot([file])
    const goodPublication = snapshot.calls.get(goodCall)
    const badPublication = snapshot.calls.get(badCall)
    Expect(goodPublication?.kind).toBe('complete')
    Expect(goodPublication?.target).toBe(method)
    Expect(Type.displayName(goodPublication!.descriptor!.signature!.inputs[0]!.type)).toBe('Child')
    Expect(Type.displayName(goodPublication!.descriptor!.result!)).toBe('Child')
    Expect(badPublication?.kind).toBe('unknown')
    Expect(badPublication?.target).toBe(method)
    Expect(badPublication?.descriptor?.result?.kind).toBe('unresolved')
  })

  Test('combines real bounds and specializes concrete and inherited Self without changing witness owners', async () => {
    const file = await parse(contracts)
    const earlier = namedFunction(file, 'Earlier')
    const symbolic = Type.ofParameter(earlier.parameterList.parameters[0]!)
    Expect(symbolic.genericParameter).toBe(earlier.genericParameters[0])
    Expect(Object.isFrozen(symbolic.genericBounds)).toBe(true)
    Expect(Type.aggregateCapabilityRequirements(symbolic).map(method => method.name)).toEqual(['Compare', 'ToText'])
    const inspection = AST.returnStatementsOf(namedFunction(file, 'Inspect'))[0]!.value
    Expect.Is(inspection, AST.isMethodCallExpression)
    Expect(Type.displayName(Type.ofExpression(inspection))).toBe('text')
    const celsius = namedType(file, 'Celsius')
    const room = namedType(file, 'RoomReading')
    const method = ASTUtils.ownAssociatedMethods(celsius)[0]!
    const descriptor = Type.associatedCallable(method, celsius)
    Assert(descriptor.kind === 'ready', 'the fixture comparison contract is materialized')
    Expect(descriptor.descriptor.signature.inputs[0]!.type.selfOwner).toBe(celsius)
    const inherited = Type.specializeAssociatedDescriptor(descriptor.descriptor, Type.ofDefinition(room))
    Expect(inherited.owner).toBe(celsius)
    Expect(Type.displayName(inherited.receiver)).toBe('Celsius')
    Expect(Type.displayName(inherited.signature.inputs[0]!.type)).toBe('RoomReading')
    withEvidence(file, () => {
      const comparable = Type.ofDefinition(namedType(file, 'Comparable'))
      Assert(comparable.kind === 'capability', 'the fixture bound is a capability')
      const witnesses = Type.capabilityWitnesses(Type.ofDefinition(room), comparable)
      Expect(witnesses).toHaveLength(1)
      Expect(witnesses?.[0]?.supplied.owner).toBe(celsius)
      Expect(Type.isAssignable(symbolic, comparable)).toBe(true)
    })
  })

  Test('selects the supplied ancestor in either argument order and publishes concrete call domains', async () => {
    const file = await parse(`${contracts}
      func Forward(Cold Celsius, Warm RoomReading) -> Celsius { return Earlier(Left: Cold, Right: Warm) }
      func Reverse(Cold Celsius, Warm RoomReading) -> Celsius { return Earlier(Left: Warm, Right: Cold) }
    `)
    const earlier = namedFunction(file, 'Earlier')
    withEvidence(file, () => {
      for (const name of ['Forward', 'Reverse']) {
        const call = returnCall(namedFunction(file, name))
        const result = Type.instantiateGenericInvocation(earlier, AST.argumentsOf(call))
        Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
        Expect(result.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
        Expect(Type.displayName(result.result)).toBe('Celsius')
        Expect([...result.parameterTypes.values()].map(Type.displayName)).toEqual(['Celsius', 'Celsius'])
        Expect(result.bindings.get(earlier.genericParameters[0]!)).toBeDefined()
        Expect(result.transportTypes.get(earlier.parameterList.parameters[0]!)?.genericParameter).toBe(
          earlier.genericParameters[0],
        )
        const transported = result.transportTypes.get(earlier.parameterList.parameters[0]!)!
        Assert(transported.kind === 'capability', 'the transported generic carries capability requirements')
        const witnesses = Type.capabilityWitnesses(Type.ofDefinition(namedType(file, 'RoomReading')), transported)
        Expect(witnesses?.map(witness => witness.required.declaration.name)).toEqual(['Compare', 'ToText'])
        Expect(Type.displayName(witnesses![0]!.supplied.signature.inputs[0]!.type)).toBe('Celsius')
        Expect(Type.displayName(witnesses![0]!.required.signature.inputs[0]!.type)).toBe('Celsius')
        Expect(Type.displayName(Type.ofExpression(call))).toBe('Celsius')
      }
    })
    const snapshot = publishCanonicalEffectSnapshot([file])
    const calls = [...snapshot.calls.values()].filter(call => call.target === earlier)
    Expect(calls).toHaveLength(2)
    Expect(calls.map(call => call.kind)).toEqual(['complete', 'complete'])
    Expect(calls.map(call => call.descriptor?.result && Type.displayName(call.descriptor.result))).toEqual([
      'Celsius',
      'Celsius',
    ])
  })

  Test('rejects siblings instead of inventing an absent ancestor or a conversion', async () => {
    const file = await parse(`${contracts}
      func Siblings(Cold Celsius, Warm Fahrenheit) -> number { return Earlier(Left: Cold, Right: Warm) }
    `)
    withEvidence(file, () => {
      const earlier = namedFunction(file, 'Earlier')
      const result = Type.instantiateGenericInvocation(
        earlier,
        AST.argumentsOf(returnCall(namedFunction(file, 'Siblings'))),
      )
      Expect(result.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual(['incompatible-generic'])
      Expect(result.bindings.size).toBe(0)
      Expect(result.result.kind).toBe('unresolved')
    })
  })

  Test('dispatches under inferred T instead of a supplied child comparison override', async () => {
    const file = await parse(`${
      contracts.replace(
        'type RoomReading is Celsius',
        `
      type RoomReading is Celsius with {
        func Compare(Other Self) fails never -> boolean { return false }
      }
    `,
      )
    }
      func Forward(Cold Celsius, Warm RoomReading) -> Celsius { return Earlier(Left: Cold, Right: Warm) }
      func Reverse(Cold Celsius, Warm RoomReading) -> Celsius { return Earlier(Left: Warm, Right: Cold) }
    `)
    const earlier = namedFunction(file, 'Earlier')
    const celsius = namedType(file, 'Celsius')
    const room = namedType(file, 'RoomReading')
    const parentComparison = ASTUtils.ownAssociatedMethods(celsius)[0]!
    const childComparison = ASTUtils.ownAssociatedMethods(room)[0]!
    const roomType = Type.ofDefinition(room)
    withEvidence(file, () => {
      for (const name of ['Forward', 'Reverse']) {
        const result = Type.instantiateGenericInvocation(
          earlier,
          AST.argumentsOf(returnCall(namedFunction(file, name))),
        )
        Expect(result.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
        Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
        Expect(Type.displayName(result.result)).toBe('Celsius')
        const transported = result.transportTypes.get(earlier.parameterList.parameters[0]!)!
        const witnesses = Type.capabilityWitnesses(roomType, transported)!
        Expect(witnesses.map(witness => witness.required.declaration.name)).toEqual(['Compare', 'ToText'])
        Expect(witnesses[0]!.receiver).toBe(roomType)
        Expect(witnesses[0]!.supplied.owner).toBe(celsius)
        Expect(witnesses[0]!.supplied.declaration).toBe(parentComparison)
        Expect(Type.displayName(witnesses[0]!.required.signature.inputs[0]!.type)).toBe('Celsius')
        Expect(Type.displayName(witnesses[0]!.supplied.signature.inputs[0]!.type)).toBe('Celsius')
        Expect(Type.capabilityWitnesses(Type.ofDefinition(namedType(file, 'Fahrenheit')), transported)).toBeUndefined()
      }
      const ordinary = Type.capabilityWitnesses(roomType, Type.ofDefinition(namedType(file, 'Comparable')))!
      Expect(ordinary[0]!.supplied.owner).toBe(room)
      Expect(ordinary[0]!.supplied.declaration).toBe(childComparison)
      Expect(Type.displayName(ordinary[0]!.supplied.signature.inputs[0]!.type)).toBe('RoomReading')
    })
  })

  Test('keeps independent symbols distinct even when all bounds agree', async () => {
    const file = await parse(`${contracts}
      func Different where type T is Comparable and Display, type T2 is Comparable and Display
        (Left T, Right T2) -> T { return Left }
    `)
    const declaration = namedFunction(file, 'Different')
    const left = Type.ofParameter(declaration.parameterList.parameters[0]!)
    const right = Type.ofParameter(declaration.parameterList.parameters[1]!)
    Expect(Type.displayName(left)).toBe('T')
    Expect(Type.displayName(right)).toBe('T2')
    Expect(Type.identityKey(left) === Type.identityKey(right)).toBe(false)
    Expect(Type.isCallableAssignable(left, right)).toBe(false)
    Expect(Type.isCallableAssignable(right, left)).toBe(false)
    Expect(Type.isCallableAssignable(Type.ofDefinition(namedType(file, 'Comparable')), left)).toBe(false)
  })

  Test('raw literals and omitted defaults cannot infer a symbolic domain', async () => {
    const file = await parse(`
      func Echo where type T is number (Value T default 1) -> T { return Value }
      func Raw() -> number { return Echo(Value: 1) }
      func Omitted() -> number { return Echo() }
    `)
    const echo = namedFunction(file, 'Echo')
    for (const name of ['Raw', 'Omitted']) {
      const result = Type.instantiateGenericInvocation(echo, AST.argumentsOf(returnCall(namedFunction(file, name))))
      Expect(result.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual(['uninferred-generic'])
      Expect(result.bindings.size).toBe(0)
    }
  })

  Test('generic role constructors expose a typed payload and exclude a raw payload from inference', async () => {
    const file = await parse(`
      type Celsius is number
      func Echo where type T is number (Value T) -> T { return Value }
      func Typed(Cold Celsius) -> Celsius { return Echo(.Value Cold) }
      func Raw() -> number { return Echo(.Value 3) }
    `)
    const echo = namedFunction(file, 'Echo')
    const typedArgument = AST.argumentsOf(returnCall(namedFunction(file, 'Typed')))[0]!
    const role = Type.genericRoleConstructor(typedArgument)
    Expect(role?.parameter).toBe(echo.parameterList.parameters[0])
    Expect.Is(role?.value, AST.isValueReference)
    Expect(Type.displayName(Type.ofArgument(typedArgument))).toBe('Celsius')
    const typed = Type.instantiateGenericInvocation(echo, [typedArgument])
    Expect(typed.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(typed.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(Type.displayName(typed.result)).toBe('Celsius')
    const raw = Type.instantiateGenericInvocation(echo, AST.argumentsOf(returnCall(namedFunction(file, 'Raw'))))
    Expect(raw.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual(['uninferred-generic'])
    Expect(raw.bindings.size).toBe(0)
  })

  Test('retains later capability bounds on a scalar first-bound carrier for discovery and transport', async () => {
    const file = await parse(`${contracts}
      func Scalar where type T is number and Display (Value T) -> T { return Value }
      func ReadScalar where type T is number and Display (Value T) -> text { return Value.ToText() }
      func Supply(Cold Celsius) -> Celsius { return Scalar(Cold) }
    `)
    const scalar = namedFunction(file, 'Scalar')
    const symbolic = Type.ofParameter(scalar.parameterList.parameters[0]!)
    Expect(symbolic.kind).toBe('primitive')
    Expect(Type.aggregateCapabilityRequirements(symbolic).map(method => method.name)).toEqual(['ToText'])
    const methods = Type.capabilityMethods(symbolic)
    Expect(methods).toHaveLength(1)
    Expect(methods[0]?.kind).toBe('ready')
    const read = AST.returnStatementsOf(namedFunction(file, 'ReadScalar'))[0]!.value
    Expect.Is(read, AST.isMethodCallExpression)
    Expect(Type.displayName(Type.ofExpression(read))).toBe('text')
    withEvidence(file, () => {
      const result = Type.instantiateGenericInvocation(
        scalar,
        AST.argumentsOf(returnCall(namedFunction(file, 'Supply'))),
      )
      Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(result.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      const transported = result.transportTypes.get(scalar.parameterList.parameters[0]!)!
      Expect(transported.kind).toBe('primitive')
      Expect(Type.displayName(transported.genericReceiver!)).toBe('Celsius')
      const witnesses = Type.capabilityWitnesses(Type.ofDefinition(namedType(file, 'Celsius')), transported)
      Expect(witnesses?.map(witness => witness.required.declaration.name)).toEqual(['ToText'])
    })
  })
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source)
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = file.statements.find(value => AST.isFunctionDeclaration(value) && value.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(value => AST.isTypeDeclaration(value) && value.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

function returnCall(declaration: AST.FunctionDeclaration): AST.FunctionCallExpression {
  const value = AST.returnStatementsOf(declaration)[0]?.value
  Expect.Is(value, AST.isFunctionCallExpression)
  return value
}

function withEvidence<T>(file: AST.TaoFile, consume: () => T): T {
  const descriptors = new Map<
    ASTUtils.AssociatedCallableDescriptor['declaration'],
    ASTUtils.AssociatedCallableDescriptor
  >()
  const analyses = new Map<AST.Node, ReturnType<typeof analyzeCallableEffects>>()
  for (const owner of file.statements.filter(AST.isTypeDeclaration)) {
    for (const declaration of [...ASTUtils.ownAssociatedMethods(owner), ...ASTUtils.capabilityRequirements(owner)]) {
      const materialized = Type.associatedCallable(declaration, owner)
      Assert(materialized.kind === 'ready', 'the fixture declares complete associated domains')
      descriptors.set(declaration, materialized.descriptor)
      if (AST.isAssociatedFunctionDeclaration(declaration)) {
        analyses.set(
          declaration,
          analyzeCallableEffects(declaration, [{
            kind: 'complete',
            node: declaration,
            purity: { violations: [], open: false },
            failures: { cases: [], open: false },
            executes: [],
          }]),
        )
      }
    }
  }
  return ASTUtils.withAssociatedEffects({ descriptors, analyses }, consume)
}
