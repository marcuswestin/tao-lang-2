import { ASTUtils, Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { analyzeCallableEffects, type CallableAnalysis } from '../ast-utils-src/callable-effects'

async function contracts(source: string) {
  const parsed = await Parser.parseCode(source)
  Expect(parsed.diagnostics).toEqual([])
  const owners = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
  const descriptors = new Map<
    AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
    ASTUtils.AssociatedCallableDescriptor
  >()
  for (const owner of owners) {
    for (const method of [...ASTUtils.ownAssociatedMethods(owner), ...ASTUtils.capabilityRequirements(owner)]) {
      const materialized = Type.associatedCallable(method, owner)
      Assert(materialized.kind === 'ready', 'Expected a ready fixture contract.')
      descriptors.set(method, materialized.descriptor)
    }
  }
  const named = (name: string) => {
    const owner = owners.find(owner => owner.name === name)
    Assert(owner, 'Expected a named fixture owner.')
    return owner
  }
  return { descriptors, named }
}

function analyzed(method: AST.AssociatedFunctionDeclaration, failures = { cases: [] as string[], open: false }) {
  // These tests exercise admission over explicit facts; source-fact discovery is a separate producer.
  return analyzeCallableEffects(method, [{
    node: method,
    kind: 'complete',
    purity: { open: false, violations: [] },
    failures,
    executes: [],
  }])
}

Describe('sealed associated capability admission', () => {
  Test('requires proved effects and retains inherited owner and reordered parameter correspondence', async () => {
    const { descriptors, named } = await contracts(`
      type Token is text with {
        func ToText(Count number, Prefix text default "token") -> text { return Prefix }
      }
      type Child is Token
      can Display { ToText(Prefix text default "display", Count number) -> text }
    `)
    const child = Type.ofDefinition(named('Child'))
    const display = Type.ofDefinition(named('Display'))
    Assert(display.kind === 'capability', 'Expected a capability contract.')
    const method = ASTUtils.ownAssociatedMethods(named('Token'))[0]!
    Expect(Type.isAssignable(child, display)).toBe(false)
    const analyses = new Map([[method, analyzed(method)]])
    ASTUtils.withAssociatedEffects({ descriptors, analyses }, () => {
      Expect(Type.isAssignable(child, display)).toBe(true)
      const witnesses = Type.capabilityWitnesses(child, display)!
      Expect(witnesses).toHaveLength(1)
      Expect(witnesses[0]!.receiver === child).toBe(true)
      Expect(witnesses[0]!.supplied.owner === named('Token')).toBe(true)
      Expect(witnesses[0]!.correspondence.map(pair => pair.required.localName)).toEqual(['Count', 'Prefix'])
    })
    Expect(Type.isAssignable(child, display)).toBe(false)
  })

  Test('denies missing, unknown and impure effects and enforces the full failure bound', async () => {
    const { descriptors, named } = await contracts(`
      type Token is text with { func ToText() -> text { return "token" } }
      can Display { ToText() fails never -> text }
    `)
    const token = Type.ofDefinition(named('Token'))
    const display = Type.ofDefinition(named('Display'))
    const method = ASTUtils.ownAssociatedMethods(named('Token'))[0]!
    const pure = analyzed(method)
    const cases: (CallableAnalysis | undefined)[] = [
      undefined,
      { ...pure, effects: { ...pure.effects, purity: { open: true, violations: [] } } },
      { ...pure, effects: { ...pure.effects, purity: { open: false, violations: ['io'] } } },
      analyzed(method, { cases: ['Offline'], open: false }),
      analyzed(method, { cases: [], open: true }),
    ]
    for (const analysis of cases) {
      const analyses = new Map<AST.Node, CallableAnalysis>(analysis ? [[method, analysis]] : [])
      ASTUtils.withAssociatedEffects({ descriptors, analyses }, () => {
        Expect(Type.isAssignable(token, display)).toBe(false)
      })
    }
    ASTUtils.withAssociatedEffects({ descriptors, analyses: new Map([[method, pure]]) }, () => {
      Expect(Type.isAssignable(token, display)).toBe(true)
    })
  })

  Test('does not fall through a missing nearest method descriptor to an inherited implementation', async () => {
    const { descriptors, named } = await contracts(`
      type Token is text with { func ToText() -> text { return "token" } }
      type Child is Token with { func ToText() -> text { return "child" } }
      can Display { ToText() -> text }
    `)
    const base = ASTUtils.ownAssociatedMethods(named('Token'))[0]!
    const childMethod = ASTUtils.ownAssociatedMethods(named('Child'))[0]!
    descriptors.delete(childMethod)
    ASTUtils.withAssociatedEffects({ descriptors, analyses: new Map([[base, analyzed(base)]]) }, () => {
      Expect(Type.isAssignable(Type.ofDefinition(named('Child')), Type.ofDefinition(named('Display')))).toBe(false)
      Expect(Type.associatedMethods(Type.ofDefinition(named('Child')))).toEqual([])
    })
  })

  Test('enforces a supplied closed bound even when the requirement allows unknown failures', async () => {
    const { descriptors, named } = await contracts(`
      type Token is text with { func ToText() fails never -> text { return "token" } }
      can Display { ToText() -> text }
    `)
    const method = ASTUtils.ownAssociatedMethods(named('Token'))[0]!
    for (const failures of [{ cases: ['Offline'], open: false }, { cases: [], open: true }]) {
      ASTUtils.withAssociatedEffects({ descriptors, analyses: new Map([[method, analyzed(method, failures)]]) }, () => {
        Expect(Type.isAssignable(Type.ofDefinition(named('Token')), Type.ofDefinition(named('Display')))).toBe(false)
      })
    }
  })

  Test('does not construct shortcuts or invent anonymous result fields during substitution', async () => {
    const { descriptors, named } = await contracts(`
      type Key is shortcut
      can BroadText { Read() -> text }
      can NamedKey { Read() -> Key }
      can Codes { Read() -> { Code number } }
      can Labels { Read() -> { Label text } }
    `)
    const codeResult = descriptors.get(ASTUtils.capabilityRequirements(named('Codes'))[0]!)!.result
    const labelResult = descriptors.get(ASTUtils.capabilityRequirements(named('Labels'))[0]!)!.result
    ASTUtils.withAssociatedEffects({ descriptors, analyses: new Map() }, () => {
      Expect(Type.isAssignable(Type.ofDefinition(named('BroadText')), Type.ofDefinition(named('NamedKey')))).toBe(false)
      Expect(Type.isAssignable(Type.ofDefinition(named('Codes')), Type.ofDefinition(named('Labels')))).toBe(false)
      Expect(Type.isCallableAssignable({ kind: 'list', element: codeResult }, { kind: 'list', element: labelResult }))
        .toBe(false)
      Expect(Type.isAssignable(codeResult, labelResult)).toBe(true)
    })
  })

  Test('projects declared capability contracts covariantly and refuses recursive unproved comparison', async () => {
    const { descriptors, named } = await contracts(`
      type Token is text
      can Specific { ToText() -> Token }
      can Display { ToText() -> text }
      can SpecificList { Values() -> list of Token }
      can BroadList { Values() -> list of text }
      can First { Next() -> First }
      can Second { Next() -> Second }
    `)
    ASTUtils.withAssociatedEffects({ descriptors, analyses: new Map() }, () => {
      Expect(Type.isAssignable(Type.ofDefinition(named('Specific')), Type.ofDefinition(named('Display')))).toBe(true)
      Expect(Type.isAssignable(Type.ofDefinition(named('Display')), Type.ofDefinition(named('Specific')))).toBe(false)
      Expect(Type.isAssignable(Type.ofDefinition(named('SpecificList')), Type.ofDefinition(named('BroadList')))).toBe(
        true,
      )
      Expect(Type.isAssignable(Type.ofDefinition(named('BroadList')), Type.ofDefinition(named('SpecificList')))).toBe(
        false,
      )
      Expect(Type.isAssignable(Type.ofDefinition(named('First')), Type.ofDefinition(named('Second')))).toBe(false)
      Expect(Type.isAssignable(Type.ofDefinition(named('First')), Type.ofDefinition(named('First')))).toBe(true)
    })
  })
})
