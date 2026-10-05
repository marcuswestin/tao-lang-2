import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { withAssociatedEffects } from '../ast-utils-src/associated-methods'
import { type CapabilityTransportPlan, planCapabilityTransport } from '../ast-utils-src/capability-transport'
import { type TaoType, Type } from '../ast-utils-src/Type'

const declarations = `
  type Token is text with { func Format() -> text { return "token" } }
  can Display { Format() -> text }
  can Full { Format() -> text, Again() -> text }
`

Describe('Capability list transport', () => {
  Test('freezes attachment domains while retaining actual named list provenance', async () => {
    const file = await parse(`${declarations}
      type Tokens is list of Token
      type Displays is list of Display
    `)
    withProof(file, () => {
      const tokens = namedType(file, 'Tokens')
      const actual = Type.ofDefinition(tokens)
      const expected = list(Type.ofDefinition(namedType(file, 'Display')))
      const plan = listPlan(planCapabilityTransport(actual, expected))
      Expect(plan.actual.nominal).toBe(tokens)
      Expect(plan.expected.nominal).toBeUndefined()
      Assert(plan.actual.element?.kind === 'primitive', 'token list has actual nominal elements')
      Expect(plan.actual.element.nominal).toBe(namedType(file, 'Token'))
      Expect(plan.element.kind).toBe('attach')
      Expect(Object.isFrozen(plan)).toBe(true)
      Expect(Object.isFrozen(plan.actual)).toBe(true)
      Expect(Object.isFrozen(plan.actual.element)).toBe(true)
      Expect(Object.isFrozen(plan.expected)).toBe(true)
      Expect(Object.isFrozen(plan.element)).toBe(true)
      Expect(planCapabilityTransport(actual, Type.ofDefinition(namedType(file, 'Displays')), 'callable'))
        .toEqual({ kind: 'unsupported', reason: 'incompatible-types' })
    })
  })

  Test('represents reprojection, optional elements and nested list mappings recursively', async () => {
    const file = await parse(declarations)
    withProof(file, () => {
      const token = Type.ofDefinition(namedType(file, 'Token'))
      const display = Type.ofDefinition(namedType(file, 'Display'))
      const full = Type.ofDefinition(namedType(file, 'Full'))
      Expect(listPlan(planCapabilityTransport(list(full), list(display))).element.kind).toBe('reproject')
      const optional = listPlan(planCapabilityTransport(
        list({ kind: 'union', members: [token, Type.ofNone()] }),
        list({ kind: 'union', members: [display, Type.ofNone()] }),
      ))
      Assert(optional.element.kind === 'optional', 'absence is retained at each mapped element')
      Expect(optional.element.present.kind).toBe('attach')
      const nested = listPlan(planCapabilityTransport(list(list(token)), list(list(display))))
      Assert(nested.element.kind === 'list', 'nested list mapping is represented explicitly')
      Expect(nested.element.element.kind).toBe('attach')
      Expect(Object.isFrozen(nested.element.actual.element)).toBe(true)
    })
  })

  Test('retains actual entity handles with production constant-function proof', async () => {
    const file = await parse(`
      data Books / Book { Title text, func Book.Format() -> text { return "book" } }
      can Display { Format() -> text }
      type BookWindow is list of Book
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Assert(entity, 'fixture declares a real entity')
    withProof(file, () => {
      const plan = listPlan(
        planCapabilityTransport(
          Type.ofDefinition(namedType(file, 'BookWindow')),
          list(Type.ofDefinition(namedType(file, 'Display'))),
        ),
      )
      Assert(plan.actual.element?.kind === 'entity', 'entity list retains its row handle domain')
      Expect(plan.actual.element.entity).toBe(entity)
      Assert(plan.element.kind === 'attach', 'entity row gets the sealed structural witness')
      Expect(plan.element.methods[0]!.supplied.owner).toBe(entity)
      Expect(plan.element.methods[0]!.supplied.declaration).toBe(
        entity.block.entries.find(AST.isAssociatedFunctionDeclaration),
      )
    })
  })

  Test('accepts equal mapped execution domains and rejects erased nominal list alternatives', async () => {
    const file = await parse(`${declarations}
      type Tokens is list of Token
      type OtherTokens is list of Token
      type Child is Token
    `)
    withProof(file, () => {
      const token = Type.ofDefinition(namedType(file, 'Token'))
      const expected = list(Type.ofDefinition(namedType(file, 'Display')))
      Expect(planCapabilityTransport({ kind: 'union', members: [list(token), list(token)] }, expected).kind).toBe(
        'ready',
      )
      Expect(
        planCapabilityTransport({
          kind: 'union',
          members: [Type.ofDefinition(namedType(file, 'Tokens')), Type.ofDefinition(namedType(file, 'OtherTokens'))],
        }, expected),
      )
        .toEqual({ kind: 'unsupported', reason: 'erased-union' })
      Expect(
        planCapabilityTransport({
          kind: 'union',
          members: [list(token), list(Type.ofDefinition(namedType(file, 'Child')))],
        }, expected),
      )
        .toEqual({ kind: 'unsupported', reason: 'erased-union' })
    })
  })

  Test('retains unknown missing element or effect evidence', async () => {
    const file = await parse(declarations)
    const token = Type.ofDefinition(namedType(file, 'Token'))
    const display = Type.ofDefinition(namedType(file, 'Display'))
    Expect(planCapabilityTransport(list(token), list(display))).toEqual({ kind: 'unknown', reason: 'missing-effects' })
    withAssociatedEffects({ descriptors: new Map(), analyses: new Map() }, () => {
      Expect(planCapabilityTransport(list(token), list(display))).toEqual({ kind: 'unknown', reason: 'missing-proof' })
      Expect(planCapabilityTransport({ kind: 'list' }, list(display))).toEqual({
        kind: 'unknown',
        reason: 'missing-proof',
      })
      Expect(planCapabilityTransport(list({ kind: 'unresolved' }), list(display)))
        .toEqual({ kind: 'unknown', reason: 'unresolved-domain' })
    })
  })

  Test('uses the actual binder-recorded generic list receiver for receiving admission', async () => {
    const file = await parse(`${declarations}
      func Receive where type T is Display (Values list of T) -> text { return "received" }
      func Feed(Values list of Token) -> text { return Receive(Values) }
    `)
    withProof(file, () => {
      const receive = namedFunction(file, 'Receive')
      const call = AST.returnStatementsOf(namedFunction(file, 'Feed'))[0]!.value
      Assert(AST.isFunctionCallExpression(call), 'fixture uses an actual generic invocation')
      const invocation = Type.instantiateGenericInvocation(receive, AST.argumentsOf(call))
      Expect(invocation.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      const receiving = invocation.transportTypes.get(receive.parameterList.parameters[0]!)
      Assert(
        receiving?.kind === 'list' && receiving.element?.genericReceiver,
        'binder records the real element receiver',
      )
      const actual = Type.ofParameter(namedFunction(file, 'Feed').parameterList.parameters[0]!)
      const plan = listPlan(planCapabilityTransport(actual, receiving))
      Expect(plan.element.kind).toBe('attach')
      Expect(plan.expected.element?.genericParameter).toBe(receive.genericParameters[0])
      Expect(Type.identityKey(plan.expected.element!.genericReceiver!))
        .toBe(Type.identityKey(Type.ofDefinition(namedType(file, 'Token'))))
    })
  })

  Test('does not equate independent generic symbols sharing the same bound', async () => {
    const file = await parse(`${declarations}
      func Independent where type T is Display, type U is Display (Left list of T, Right list of U) -> text { return "value" }
    `)
    withProof(file, () => {
      const declaration = namedFunction(file, 'Independent')
      const actual = Type.ofParameter(declaration.parameterList.parameters[0]!)
      const expected = Type.ofParameter(declaration.parameterList.parameters[1]!)
      Expect(planCapabilityTransport(actual, expected, 'callable'))
        .toEqual({ kind: 'unsupported', reason: 'incompatible-types' })
    })
  })

  Test('preserves identical captured contracts and reprojects wider symbolic list witnesses', async () => {
    const file = await parse(`${declarations}
      func Receive where type T is Display (Values list of T) -> text { return "received" }
      func Forward where type U is Display (Values list of U) -> text { return Receive(Values) }
      func Wider where type U is Full (Values list of U) -> text { return Receive(Values) }
    `)
    withProof(file, () => {
      const forward = namedFunction(file, 'Forward')
      const receive = namedFunction(file, 'Receive')
      const call = AST.returnStatementsOf(forward)[0]!.value
      Assert(AST.isFunctionCallExpression(call), 'actual generic list forwarding exists')
      const invocation = Type.instantiateGenericInvocation(receive, AST.argumentsOf(call))
      Expect(invocation.genericDiagnostics).toEqual([])
      const receiving = invocation.transportTypes.get(receive.parameterList.parameters[0]!)!
      const actual = Type.ofParameter(forward.parameterList.parameters[0]!)
      const forwardResult = planCapabilityTransport(actual, receiving)
      Assert(forwardResult.kind === 'ready', 'actual symbolic forwarding has a complete plan')
      Expect(forwardResult.plan.kind).toBe('identity')
      const wider = namedFunction(file, 'Wider')
      const widerCall = AST.returnStatementsOf(wider)[0]!.value
      Assert(AST.isFunctionCallExpression(widerCall), 'actual wider generic list forwarding exists')
      const widerInvocation = Type.instantiateGenericInvocation(receive, AST.argumentsOf(widerCall))
      Expect(widerInvocation.genericDiagnostics).toEqual([])
      const widerReceiving = widerInvocation.transportTypes.get(receive.parameterList.parameters[0]!)!
      const plan = listPlan(
        planCapabilityTransport(Type.ofParameter(wider.parameterList.parameters[0]!), widerReceiving),
      )
      Assert(plan.element.kind === 'reproject', 'wider source uses real captured contract reprojection')
      Expect(plan.element.methods[0]!.required.owner).toBe(namedType(file, 'Display'))
      Expect(plan.element.methods[0]!.supplied.owner).toBe(namedType(file, 'Full'))
      Expect(plan.actual.element?.genericParameter).toBe(wider.genericParameters[0])
      Expect(plan.expected.element?.genericReceiver?.genericParameter).toBe(wider.genericParameters[0])
    })
  })

  Test('retains writable list invariance while representing the readonly adaptation', async () => {
    const file = await parse(`${declarations}
      type Consumer is text with {
        func Consume(mutable Values list of Display) -> text { return "consumed" }
      }
      can ConsumesFull { Consume(mutable Values list of Full) -> text }
      type Reader is text with { func Consume(Values list of Display) -> text { return "consumed" } }
      can ReadsFull { Consume(Values list of Full) -> text }
    `)
    withProof(file, () => {
      Expect(
        planCapabilityTransport(
          Type.ofDefinition(namedType(file, 'Consumer')),
          Type.ofDefinition(namedType(file, 'ConsumesFull')),
        ),
      )
        .toEqual({ kind: 'unsupported', reason: 'incompatible-types' })
      const readonly = planCapabilityTransport(
        Type.ofDefinition(namedType(file, 'Reader')),
        Type.ofDefinition(namedType(file, 'ReadsFull')),
      )
      Assert(readonly.kind === 'ready' && readonly.plan.kind === 'attach', 'readonly list adaptation is admitted')
      Expect(readonly.plan.methods[0]!.inputs[0]!.plan.kind).toBe('list')
    })
  })
})

function list(element: TaoType): Extract<TaoType, { kind: 'list' }> {
  return { kind: 'list', element }
}

function listPlan(
  result: ReturnType<typeof planCapabilityTransport>,
): Extract<CapabilityTransportPlan, { kind: 'list' }> {
  Assert(result.kind === 'ready' && result.plan.kind === 'list', 'actual transport requires a recursive list plan')
  return result.plan
}

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === name)
  Assert(AST.isTypeDeclaration(declaration), 'fixture contains the real named type')
  return declaration
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Assert(AST.isFunctionDeclaration(declaration), 'fixture contains the real function')
  return declaration
}

function withProof<T>(file: AST.TaoFile, consume: () => T): T {
  return withAssociatedEffects(createAssociatedEffects([file]), consume)
}
