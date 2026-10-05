import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type AssociatedCallableDescriptor,
  capabilityRequirements,
  ownAssociatedMethods,
  withAssociatedEffects,
} from '../ast-utils-src/associated-methods'
import { analyzeCallableEffects } from '../ast-utils-src/callable-effects'
import { planCapabilityTransport } from '../ast-utils-src/capability-transport'
import { Type } from '../ast-utils-src/Type'

Describe('Operator capability admission', () => {
  Test('retains static receiver and full declarations across unary/binary requirement selection', async () => {
    const file = await parse(`
      type Amount is number with {
        static func +(Left Amount) -> Amount { return Left }
        static func +(Left Amount, Other Amount) -> Amount { return Left }
      }
      can Arithmetic { +() -> Self, +(Other Self) -> Self }
    `)
    const amount = namedType(file, 'Amount')
    const capability = namedType(file, 'Arithmetic')
    withParsedAssociatedEvidence(file, () => {
      const witnesses = Type.capabilityWitnesses(Type.ofDefinition(amount), Type.ofDefinition(capability))
      Assert(witnesses, 'actual static contracts satisfy both arities')
      Expect(witnesses).toHaveLength(2)
      for (const [index, witness] of witnesses.entries()) {
        Expect(witness.required.declaration).toBe(capabilityRequirements(capability)[index])
        Expect(witness.supplied.declaration).toBe(ownAssociatedMethods(amount)[index])
        Expect(witness.supplied.signature.inputs).toHaveLength(index + 1)
        Expect(witness.correspondence).toHaveLength(index)
        Assert(witness.receiverPlacement.kind === 'parameter', 'real static receiver parameter selected')
        Expect(witness.receiverPlacement.parameter).toBe(AST.parametersOf(ownAssociatedMethods(amount)[index]!)[0])
      }
      const plan = planCapabilityTransport(Type.ofDefinition(amount), Type.ofDefinition(capability))
      Assert(plan.kind === 'ready' && plan.plan.kind === 'attach', 'static attachment planned')
      Expect(plan.plan.methods[1]!.receiverPlacement.kind).toBe('parameter')
      Expect(plan.plan.methods[1]!.inputs[0]!.supplied.declaration).toBe(
        AST.parametersOf(ownAssociatedMethods(amount)[1]!)[1],
      )
    })
  })

  Test('does not specialize authored arithmetic Base results to Child', async () => {
    const file = await parse(`
      type Base is number with { static func +(Left Base, Other Base) -> Base { return Left } }
      type Child is Base
      can Arithmetic { +(Other Self) -> Self }
      func Parent(Value Base) -> Arithmetic { return Value }
      func Descendant(Value Child) -> Arithmetic { return Value }
    `)
    withParsedAssociatedEvidence(file, () => {
      Expect(
        Type.capabilityWitnesses(
          Type.ofDefinition(namedType(file, 'Child')),
          Type.ofDefinition(namedType(file, 'Arithmetic')),
        ),
      ).toBeUndefined()
      const parent = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === 'Parent')
      const descendant = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === 'Descendant')
      Expect.Is(parent, AST.isFunctionDeclaration)
      Expect.Is(descendant, AST.isFunctionDeclaration)
      const capability = Type.ofDefinition(namedType(file, 'Arithmetic'))
      const parentValue = Type.ofExpression(AST.returnStatementsOf(parent)[0]!.value)
      const descendantValue = Type.ofExpression(AST.returnStatementsOf(descendant)[0]!.value)
      Expect(Type.capabilityWitnesses(parentValue, capability)?.[0]?.supplied.owner).toBe(namedType(file, 'Base'))
      Expect(Type.capabilityWitnesses(descendantValue, capability)).toBeUndefined()
      Expect(Type.isCallableAssignable(descendantValue, capability)).toBe(false)
    })
  })

  Test('admits raw primitives only through an actual visible primitive operator owner', async () => {
    const file = await parse(`
      primitive number with { static func +(Left number, Other number) -> number { return Left } }
      can Arithmetic { +(Other Self) -> Self }
      func Identity(Value number) -> Arithmetic { return Value }
    `)
    const owner = file.statements.find(AST.isPrimitiveDeclaration)
    Assert(owner, 'actual primitive owner exists')
    withParsedAssociatedEvidence(file, () => {
      const witnesses = Type.capabilityWitnesses(
        Type.ofAssociatedOwner(owner),
        Type.ofDefinition(namedType(file, 'Arithmetic')),
      )
      Assert(witnesses, 'visible primitive declaration supplies operator proof')
      Expect(Type.isCallableAssignable(Type.ofAssociatedOwner(owner), Type.ofDefinition(namedType(file, 'Arithmetic'))))
        .toBe(true)
      Expect(witnesses[0]!.supplied.owner).toBe(owner)
      Expect(witnesses[0]!.supplied.declaration).toBe(ownAssociatedMethods(owner)[0])
      const identity = file.statements.find(AST.isFunctionDeclaration)
      Assert(identity, 'actual primitive parameter function exists')
      const returned = AST.returnStatementsOf(identity)[0]
      Assert(returned, 'actual primitive parameter reference exists')
      const parameter = Type.ofExpression(returned.value)
      const parameterWitnesses = Type.capabilityWitnesses(parameter, Type.ofDefinition(namedType(file, 'Arithmetic')))
      const required = Type.associatedCallable(
        capabilityRequirements(namedType(file, 'Arithmetic'))[0]!,
        namedType(file, 'Arithmetic'),
      )
      Assert(required.kind === 'ready', 'actual requirement materializes')
      const selected = Type.capabilityImplementation(
        parameter,
        Type.specializeAssociatedDescriptor(required.descriptor, parameter),
      )
      Assert(parameterWitnesses, 'inline primitive parameter retains visible primitive operator provenance', {
        parameter: Type.identityKey(parameter),
        selected: selected.kind,
        ...(selected.kind === 'ready'
          ? {
            result: Type.identityKey(selected.supplied.result),
            expected: Type.identityKey(Type.specializeAssociatedDescriptor(required.descriptor, parameter).result),
          }
          : {}),
      })
      Expect(parameterWitnesses[0]!.supplied.owner).toBe(owner)
      Expect(Type.isCallableAssignable(parameter, Type.ofDefinition(namedType(file, 'Arithmetic')))).toBe(true)
    })
  })
  Test('selects typed same-symbol contracts by actual ordered domains', async () => {
    const file = await parse(`
      type Amount is number with {
        static func +(Left Amount, Other number) -> number { return Other }
        static func +(Left Amount, Other text) -> text { return Other }
      }
      can Addition { +(Other number) -> number, +(Other text) -> text }
    `)
    const owner = namedType(file, 'Amount')
    const capability = namedType(file, 'Addition')
    withParsedAssociatedEvidence(file, () => {
      const witnesses = Type.capabilityWitnesses(Type.ofDefinition(owner), Type.ofDefinition(capability))
      Assert(witnesses, 'ordered domains select distinct executable contracts')
      Expect(witnesses).toHaveLength(2)
      witnesses.forEach((witness, index) =>
        Expect(witness.supplied.declaration).toBe(ownAssociatedMethods(owner)[index])
      )
    })
  })

  Test('rejects erased Self input alternatives with different specialized executable domains', async () => {
    const file = await parse(`
      type Base is number with { func +(Other Self) -> number { return 1 } }
      type Child is Base
      can Addition { +(Other Self) -> number }
    `)
    withParsedAssociatedEvidence(file, () => {
      Expect(
        planCapabilityTransport({
          kind: 'union',
          members: [Type.ofDefinition(namedType(file, 'Base')), Type.ofDefinition(namedType(file, 'Child'))],
        }, Type.ofDefinition(namedType(file, 'Addition'))),
      )
        .toEqual({ kind: 'unsupported', reason: 'erased-union' })
    })
  })

  Test('specializes contextual Self only for comparison contracts', async () => {
    const file = await parse(`
      type Base is number with { static func <(Left Self, Other Self) -> boolean { return yes } }
      type Child is Base
      can Ordered { <(Other Self) -> boolean }
    `)
    withParsedAssociatedEvidence(file, () => {
      const child = Type.ofDefinition(namedType(file, 'Child'))
      const witnesses = Type.capabilityWitnesses(child, Type.ofDefinition(namedType(file, 'Ordered')))
      Assert(witnesses, 'comparison Self specializes to the selected child receiver')
      Expect(Type.identityKey(witnesses[0]!.receiverDomain)).toBe(Type.identityKey(child))
      Expect(witnesses[0]!.supplied.declaration).toBe(ownAssociatedMethods(namedType(file, 'Base'))[0])
    })
  })
})

async function parse(source: string, allowDiagnostics = false): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  if (!allowDiagnostics) {
    Expect(parsed.diagnostics).toEqual([])
  }
  return parsed.entry.ast
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(value => AST.isTypeDeclaration(value) && value.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

/** Unit proof boundary: explicit sealed complete facts; production inference is tested separately. */
function withParsedAssociatedEvidence<T>(file: AST.TaoFile, consume: () => T): T {
  const descriptors = new Map<AssociatedCallableDescriptor['declaration'], AssociatedCallableDescriptor>()
  const analyses = new Map<AST.Node, ReturnType<typeof analyzeCallableEffects>>()
  for (
    const owner of file.statements.filter((node): node is AST.TypeDeclaration | AST.PrimitiveDeclaration =>
      AST.isTypeDeclaration(node) || AST.isPrimitiveDeclaration(node)
    )
  ) {
    for (
      const declaration of [
        ...ownAssociatedMethods(owner),
        ...(AST.isTypeDeclaration(owner) ? capabilityRequirements(owner) : []),
      ]
    ) {
      const materialized = Type.associatedCallable(declaration, owner)
      if (materialized.kind === 'ready') {
        descriptors.set(declaration, materialized.descriptor)
      }
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
  return withAssociatedEffects({ descriptors, analyses }, consume)
}
