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

Describe('Capability transport planning', () => {
  Test('leaves concrete attachment unknown until final associated evidence is installed', async () => {
    const file = await parse(`
      type Token is text with { func Format() -> text { return "token" } }
      can Display { Format() -> text }
    `)
    const token = namedType(file, 'Token')
    const display = namedType(file, 'Display')
    const pending = planCapabilityTransport(Type.ofDefinition(token), Type.ofDefinition(display))
    Expect(pending.kind).toBe('unknown')
    if (pending.kind === 'unknown') {
      Expect(pending.reason.length).toBeGreaterThan(0)
    }

    const admitted = withParsedAssociatedEvidence(
      file,
      () => planCapabilityTransport(Type.ofDefinition(token), Type.ofDefinition(display)),
    )
    Expect(admitted.kind).toBe('ready')
    if (admitted.kind === 'ready') {
      Assert(admitted.plan.kind === 'attach', 'concrete transport has an attachment plan')
      Expect(admitted.plan.methods).toHaveLength(1)
      Expect(admitted.plan.methods[0]?.required.declaration).toBe(capabilityRequirements(display)[0])
      Expect(admitted.plan.methods[0]?.supplied.declaration).toBe(ownAssociatedMethods(token)[0])
    }
  })

  Test('reprojects an actual capability through its parsed requirement identities', async () => {
    const file = await parse(`
      can Full { Format() -> text, Again() -> text }
      can Display { Format() -> text }
    `)
    const full = Type.ofDefinition(namedType(file, 'Full'))
    const displayDeclaration = namedType(file, 'Display')
    const display = Type.ofDefinition(displayDeclaration)
    const plan = withParsedAssociatedEvidence(file, () => planCapabilityTransport(full, display))
    Expect(plan.kind).toBe('ready')
    if (plan.kind === 'ready') {
      Assert(plan.plan.kind === 'reproject', 'capability transport has a reprojection plan')
      Expect(plan.plan.methods).toHaveLength(1)
      Expect(plan.plan.methods[0]?.required.declaration).toBe(capabilityRequirements(displayDeclaration)[0])
      Expect(plan.plan.methods[0]?.supplied.declaration).toBe(capabilityRequirements(namedType(file, 'Full'))[0])
    }
  })

  Test('accepts unique equivalent nominal union branches and rejects erased distinct implementations', async () => {
    const file = await parse(`
      type Token is text with { func Format() -> text { return "token" } }
      type Child is Token
      type Label is text with { func Format() -> text { return "label" } }
      can Display { Format() -> text }
    `)
    const token = namedType(file, 'Token')
    const child = namedType(file, 'Child')
    const label = namedType(file, 'Label')
    const display = Type.ofDefinition(namedType(file, 'Display'))
    const equivalent = withParsedAssociatedEvidence(file, () =>
      planCapabilityTransport(
        { kind: 'union', members: [Type.ofDefinition(token), Type.ofDefinition(child)] },
        display,
      ))
    Expect(equivalent.kind).toBe('ready')
    if (equivalent.kind === 'ready') {
      Assert(equivalent.plan.kind === 'attach', 'equivalent concrete members share their attachment')
      Expect(equivalent.plan.methods).toHaveLength(1)
      Expect(equivalent.plan.methods[0]?.supplied.declaration).toBe(ownAssociatedMethods(token)[0])
    }

    const erased = withParsedAssociatedEvidence(file, () =>
      planCapabilityTransport(
        { kind: 'union', members: [Type.ofDefinition(token), Type.ofDefinition(label)] },
        display,
      ))
    Expect(erased.kind).toBe('unsupported')
    if (erased.kind === 'unsupported') {
      Expect(erased.reason).toBe('erased-union')
    }
  })

  Test('carries none through an optional concrete attachment', async () => {
    const file = await parse(`
      type Token is text with { func Format() -> text { return "token" } }
      can Display { Format() -> text }
    `)
    const token = Type.ofDefinition(namedType(file, 'Token'))
    const display = Type.ofDefinition(namedType(file, 'Display'))
    const plan = withParsedAssociatedEvidence(file, () =>
      planCapabilityTransport(
        { kind: 'union', members: [Type.ofNone(), token] },
        { kind: 'union', members: [Type.ofNone(), display] },
      ))
    Expect(plan.kind).toBe('ready')
    if (plan.kind === 'ready') {
      Assert(plan.plan.kind === 'optional', 'optional transport preserves absence independently')
      Assert(plan.plan.present.kind === 'attach', 'the present member has a concrete attachment')
      Expect(plan.plan.present.methods[0]?.supplied.declaration).toBe(ownAssociatedMethods(namedType(file, 'Token'))[0])
    }
  })

  Test('retains nested contravariant input and covariant result plans with source default identities', async () => {
    const file = await parse(`
      can Base { Format() -> text }
      can Display { Format() -> text, Extra() -> text }
      type Token is text with {
        func Format() -> text { return "token" }
        func Extra() -> text { return "extra" }
        func Transform(Value Base, Suffix text default "implementation") -> Token { return Token "result" }
      }
      can Transformer {
        Transform(Value Display, Suffix text default "requirement") -> Display
      }
    `)
    const token = Type.ofDefinition(namedType(file, 'Token'))
    const transformer = Type.ofDefinition(namedType(file, 'Transformer'))
    const plan = withParsedAssociatedEvidence(file, () => planCapabilityTransport(token, transformer))
    Expect(plan.kind).toBe('ready')
    if (plan.kind === 'ready') {
      Assert(plan.plan.kind === 'attach', 'the outer concrete transport attaches its method')
      const method = plan.plan.methods[0]
      Expect(method?.required.declaration).toBe(capabilityRequirements(namedType(file, 'Transformer'))[0])
      Expect(method?.supplied.declaration).toBe(
        ownAssociatedMethods(namedType(file, 'Token')).find(
          declaration => declaration.name === 'Transform',
        ),
      )
      Expect(method?.correspondence).toHaveLength(2)
      const requiredParameters = AST.parametersOf(method!.required.declaration)
      const suppliedParameters = AST.parametersOf(method!.supplied.declaration)
      Expect(method!.correspondence.map(pair => [pair.required.declaration, pair.supplied.declaration])).toEqual([
        [requiredParameters[0], suppliedParameters[0]],
        [requiredParameters[1], suppliedParameters[1]],
      ])
      Expect(method!.inputs.map(input => [input.required.declaration, input.supplied.declaration])).toEqual([
        [requiredParameters[0], suppliedParameters[0]],
        [requiredParameters[1], suppliedParameters[1]],
      ])
      Expect(method!.correspondence[1]?.required.declaration.defaultValue).toBe(requiredParameters[1]?.defaultValue)
      Expect(method!.correspondence[1]?.supplied.declaration.defaultValue).toBe(suppliedParameters[1]?.defaultValue)
      Expect(method!.inputs[0]?.plan.kind).toBe('reproject')
      Expect(method!.result.kind).toBe('attach')
      Expect(Object.isFrozen(plan.plan)).toBe(true)
      Expect(Object.isFrozen(method!.inputs)).toBe(true)
      Expect(Object.isFrozen(method!.correspondence)).toBe(true)
      Expect(Object.isFrozen(method!.required.declaration)).toBe(false)
      Expect(Object.isFrozen(method!.supplied.declaration)).toBe(false)
    }
  })

  Test('distinguishes known missing methods from unresolved domains and missing evidence', async () => {
    const file = await parse(
      `
      type Token is text with { func Format() -> text { return "token" } }
      can Display { Format() -> text, Missing() -> text }
      func Unresolved(Value MissingType) -> text { return "unknown" }
    `,
      true,
    )
    const token = Type.ofDefinition(namedType(file, 'Token'))
    const display = Type.ofDefinition(namedType(file, 'Display'))
    const missing = withParsedAssociatedEvidence(file, () => planCapabilityTransport(token, display))
    Expect(missing).toEqual({ kind: 'unsupported', reason: 'incompatible-types' })
    const unresolvedParameter = namedFunction(file, 'Unresolved').parameterList.parameters[0]
    Expect.Is(unresolvedParameter, AST.isParameterDeclaration)
    const unresolved = withParsedAssociatedEvidence(file, () =>
      planCapabilityTransport(
        Type.ofParameter(unresolvedParameter),
        display,
      ))
    Expect(unresolved.kind).toBe('unknown')
    Expect(unresolvedParameter.$cstNode).toBeDefined()
  })

  Test('preserves source construction while keeping callable substitution strict', async () => {
    const file = await parse(`
      can Display { Format() -> text }
      type Choice is shortcut | Display
      func Literal() -> text { return "command" }
    `)
    const actual = Type.ofExpression(AST.returnStatementsOf(namedFunction(file, 'Literal'))[0]!.value)
    const expected = Type.ofDefinition(namedType(file, 'Choice'))
    withAssociatedEffects({ descriptors: new Map(), analyses: new Map() }, () => {
      Expect(Type.isAssignable(actual, expected)).toBe(true)
      Expect(Type.isCallableAssignable(actual, expected)).toBe(false)
      Expect(planCapabilityTransport(actual, expected)).toEqual({ kind: 'ready', plan: { kind: 'identity' } })
      Expect(planCapabilityTransport(actual, expected, 'callable')).toEqual({
        kind: 'unsupported',
        reason: 'incompatible-types',
      })
    })
  })

  Test('separates an impossible absence alternative from genuinely missing capability proof', async () => {
    const file = await parse(`
      type Token is text with { func Format() -> text { return "token" } }
      can Display { Format() -> text }
    `)
    const token = Type.ofDefinition(namedType(file, 'Token'))
    const display = Type.ofDefinition(namedType(file, 'Display'))
    const optional = { kind: 'union', members: [display, Type.ofNone()] } as const
    withAssociatedEffects({ descriptors: new Map(), analyses: new Map() }, () => {
      Expect(planCapabilityTransport(Type.ofNone(), optional)).toEqual({ kind: 'ready', plan: { kind: 'identity' } })
      Expect(planCapabilityTransport(display, display)).toEqual({ kind: 'unknown', reason: 'missing-proof' })
      Expect(
        planCapabilityTransport(token, { kind: 'union', members: [display, { kind: 'primitive', primitive: 'text' }] }),
      )
        .toEqual({ kind: 'unknown', reason: 'missing-proof' })
    })
  })

  Test('keeps mutually recursive capability planning unknown instead of manufacturing identity', async () => {
    const file = await parse(`
      can Left { Next() -> Left }
      can Right { Next() -> Right }
    `)
    const result = withParsedAssociatedEvidence(file, () =>
      planCapabilityTransport(
        Type.ofDefinition(namedType(file, 'Left')),
        Type.ofDefinition(namedType(file, 'Right')),
      ))
    Expect(result).toEqual({ kind: 'unknown', reason: 'recursive-plan' })
  })

  Test('rejects two eligible expected alternatives requiring different method surfaces', async () => {
    const file = await parse(`
      type Token is text with {
        func Format() -> text { return "token" }
        func Extra() -> text { return "extra" }
      }
      can First { Format() -> text }
      can Second { Extra() -> text }
      type Choice is First | Second
    `)
    const actual = Type.ofDefinition(namedType(file, 'Token'))
    const expected = Type.ofDefinition(namedType(file, 'Choice'))
    withParsedAssociatedEvidence(file, () => {
      Expect(Type.isAssignable(actual, expected)).toBe(true)
      Expect(planCapabilityTransport(actual, expected)).toEqual({
        kind: 'unsupported',
        reason: 'ambiguous-expected-union',
      })
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

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = AST.streamAllContents(file).find(value => AST.isFunctionDeclaration(value) && value.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}

function withParsedAssociatedEvidence<T>(file: AST.TaoFile, consume: () => T): T {
  const descriptors = new Map<AssociatedCallableDescriptor['declaration'], AssociatedCallableDescriptor>()
  const analyses = new Map<AST.Node, ReturnType<typeof analyzeCallableEffects>>()
  for (const owner of file.statements.filter(AST.isTypeDeclaration)) {
    for (const declaration of [...ownAssociatedMethods(owner), ...capabilityRequirements(owner)]) {
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
