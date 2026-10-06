import { AST, Parser } from '@parser'
import { Assert, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  associatedCallableAnalysis,
  type AssociatedCallableDescriptor,
  associatedCallableDescriptor,
  type AssociatedEffectsContext,
  capabilityRequirements,
  hasAssociatedEffects,
  ownAssociatedMethods,
  withAssociatedAdmissionPair,
  withAssociatedEffects,
} from '../ast-utils-src/associated-methods'
import type { CallableAnalysis } from '../ast-utils-src/callable-effects'

Describe('Sealed associated callable admission context', () => {
  Test('looks up only sealed real witnesses during its synchronous lifetime', async () => {
    const { method, requirement, descriptor, requiredDescriptor, analysis, context } = await fixture()
    Expect(hasAssociatedEffects()).toBe(false)
    Expect(associatedCallableDescriptor(method)).toBeUndefined()
    Expect(associatedCallableAnalysis(method)).toBeUndefined()
    Expect(withAssociatedEffects(context, () => {
      Expect(hasAssociatedEffects()).toBe(true)
      Expect(associatedCallableDescriptor(method)).toBe(descriptor)
      Expect(associatedCallableDescriptor(requirement)).toBe(requiredDescriptor)
      Expect(associatedCallableAnalysis(method)).toBe(analysis)
      Expect(associatedCallableAnalysis(requirement)).toBeUndefined()
      return 'consumed'
    })).toBe('consumed')
    Expect(hasAssociatedEffects()).toBe(false)
    Expect(associatedCallableDescriptor(method)).toBeUndefined()
    Expect(associatedCallableAnalysis(method)).toBeUndefined()
  })

  Test('copies caller-owned maps before admission and does not synthesize absent contracts', async () => {
    const { method, descriptor, analysis } = await fixture()
    const descriptors = new Map<
      AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
      AssociatedCallableDescriptor
    >([
      [method, descriptor],
    ])
    const analyses = new Map<AST.Node, CallableAnalysis>([[method, analysis]])
    withAssociatedEffects({ descriptors, analyses }, () => {
      descriptors.clear()
      analyses.clear()
      Expect(associatedCallableDescriptor(method)).toBe(descriptor)
      Expect(associatedCallableAnalysis(method)).toBe(analysis)
    })
    withAssociatedEffects({ descriptors, analyses }, () => {
      Expect(hasAssociatedEffects()).toBe(true)
      Expect(associatedCallableDescriptor(method)).toBeUndefined()
      Expect(associatedCallableAnalysis(method)).toBeUndefined()
    })
    Expect(hasAssociatedEffects()).toBe(false)
  })

  Test('restores outer maps after nested consumption and exceptions', async () => {
    const { method, descriptor, analysis, context } = await fixture()
    const nestedDescriptor: AssociatedCallableDescriptor = {
      ...descriptor,
      result: { kind: 'primitive', primitive: 'number' },
    }
    const nestedAnalysis: CallableAnalysis = {
      effects: { purity: { violations: ['io'], open: false }, failures: { cases: ['Missing'], open: false } },
      findings: [],
    }
    const nested: AssociatedEffectsContext = {
      descriptors: new Map([[method, nestedDescriptor]]),
      analyses: new Map([[method, nestedAnalysis]]),
    }
    withAssociatedEffects(context, () => {
      Expect(withAssociatedEffects(nested, () => {
        Expect(associatedCallableDescriptor(method)).toBe(nestedDescriptor)
        Expect(associatedCallableAnalysis(method)).toBe(nestedAnalysis)
        return 7
      })).toBe(7)
      Expect(associatedCallableDescriptor(method)).toBe(descriptor)
      Expect(associatedCallableAnalysis(method)).toBe(analysis)
      Expect(() =>
        withAssociatedEffects(nested, () => {
          Expect(associatedCallableDescriptor(method)).toBe(nestedDescriptor)
          Errors.throwUnexpected('nested admission failed')
        })
      ).toThrow('nested admission failed')
      Expect(hasAssociatedEffects()).toBe(true)
      Expect(associatedCallableDescriptor(method)).toBe(descriptor)
      Expect(associatedCallableAnalysis(method)).toBe(analysis)
    })
    Expect(() =>
      withAssociatedEffects(context, () => {
        Errors.throwUnexpected('outer admission failed')
      })
    ).toThrow('outer admission failed')
    Expect(hasAssociatedEffects()).toBe(false)
    Expect(associatedCallableDescriptor(method)).toBeUndefined()
    Expect(associatedCallableAnalysis(method)).toBeUndefined()
  })

  Test('rejects promises and thenables synchronously and restores the surrounding context', async () => {
    const { method, descriptor, context } = await fixture()
    const thenables = [Promise.resolve(true), { then: () => true }, Object.assign(() => true, { then: () => true })]
    for (const thenable of thenables) {
      const consume = () => withAssociatedEffects(context, () => thenable)
      Expect(consume).toThrow(Errors.UnexpectedBehaviorError)
      Expect(consume).toThrow('associated admission consumers return synchronously.')
      Expect(hasAssociatedEffects()).toBe(false)
      Expect(associatedCallableDescriptor(method)).toBeUndefined()
      withAssociatedEffects(context, () => {
        Expect(() => withAssociatedEffects({ descriptors: new Map(), analyses: new Map() }, () => thenable))
          .toThrow(Errors.UnexpectedBehaviorError)
        Expect(hasAssociatedEffects()).toBe(true)
        Expect(associatedCallableDescriptor(method)).toBe(descriptor)
      })
      Expect(hasAssociatedEffects()).toBe(false)
    }
    Expect(withAssociatedEffects(context, () => ({ then: 'ordinary property' }))).toEqual({ then: 'ordinary property' })
    Expect(withAssociatedEffects(context, () => null)).toBeNull()
    Expect(hasAssociatedEffects()).toBe(false)
  })

  Test('keeps same-named declarations from another AST generation out of sealed lookups', async () => {
    const first = await fixture()
    const second = await fixture()
    Expect(first.owner.name).toBe('Token')
    Expect(second.owner.name).toBe('Token')
    Expect(first.owner === second.owner).toBe(false)
    withAssociatedEffects(first.context, () => {
      Expect(associatedCallableDescriptor(first.method)).toBe(first.descriptor)
      Expect(associatedCallableDescriptor(second.method)).toBeUndefined()
      Expect(associatedCallableAnalysis(second.method)).toBeUndefined()
    })
    withAssociatedEffects(second.context, () => {
      Expect(associatedCallableDescriptor(second.method)).toBe(second.descriptor)
      Expect(associatedCallableDescriptor(first.method)).toBeUndefined()
      Expect(associatedCallableAnalysis(first.method)).toBeUndefined()
    })
    Expect(hasAssociatedEffects()).toBe(false)
  })

  Test('rejects recursive ordered declaration pairs without consuming their body', async () => {
    const { owner, capability, context } = await fixture()
    const otherGeneration = await fixture()
    let blockedConsumers = 0
    const blocked = () => {
      blockedConsumers++
      return true
    }
    Expect(withAssociatedAdmissionPair(owner, capability, blocked)).toBe(false)
    withAssociatedEffects(context, () => {
      Expect(withAssociatedAdmissionPair(owner, capability, () => {
        Expect(withAssociatedAdmissionPair(owner, capability, blocked)).toBe(false)
        Expect(withAssociatedAdmissionPair(capability, owner, () => true)).toBe(true)
        Expect(withAssociatedAdmissionPair(otherGeneration.owner, capability, () => true)).toBe(true)
        Expect(withAssociatedAdmissionPair(owner, otherGeneration.capability, () => true)).toBe(true)
        return false
      })).toBe(false)
      Expect(withAssociatedAdmissionPair(owner, capability, () => true)).toBe(true)
    })
    Expect(blockedConsumers).toBe(0)
    Expect(hasAssociatedEffects()).toBe(false)
  })

  Test('restores visiting pairs after exceptions and isolates a nested admission context', async () => {
    const { owner, capability, context } = await fixture()
    withAssociatedEffects(context, () => {
      Expect(() =>
        withAssociatedAdmissionPair(owner, capability, () => {
          Errors.throwUnexpected('pair admission failed')
        })
      ).toThrow('pair admission failed')
      Expect(withAssociatedAdmissionPair(owner, capability, () => {
        Expect(withAssociatedEffects(context, () => withAssociatedAdmissionPair(owner, capability, () => true))).toBe(
          true,
        )
        Expect(withAssociatedAdmissionPair(owner, capability, () => true)).toBe(false)
        return true
      })).toBe(true)
      Expect(withAssociatedAdmissionPair(owner, capability, () => true)).toBe(true)
    })
    withAssociatedEffects(context, () => {
      Expect(withAssociatedAdmissionPair(owner, capability, () => true)).toBe(true)
    })
    Expect(hasAssociatedEffects()).toBe(false)
  })
})

async function fixture() {
  const parsed = await Parser.parseCode(`
    type Token is text with {
      func ToText() -> text { return "token" }
    }
    can Display { ToText() -> text }
  `)
  Expect(parsed.diagnostics).toEqual([])
  const declarations = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
  const owner = declarations.find(declaration => declaration.name === 'Token')
  const capability = declarations.find(declaration => declaration.name === 'Display')
  Assert.defined(owner, 'the associated context fixture has its real method owner')
  Assert.defined(capability, 'the associated context fixture has its real capability owner')
  const method = ownAssociatedMethods(owner)[0]
  const requirement = capabilityRequirements(capability)[0]
  Assert.defined(method, 'the associated context fixture has its real implementation declaration')
  Assert.defined(requirement, 'the associated context fixture has its real requirement declaration')
  const descriptor: AssociatedCallableDescriptor = Object.freeze({
    declaration: method,
    owner,
    receiver: { kind: 'primitive', primitive: 'text', nominal: owner },
    signature: { inputs: [], failures: { cases: [], open: false } },
    result: { kind: 'primitive', primitive: 'text' },
  })
  const requiredDescriptor: AssociatedCallableDescriptor = Object.freeze({
    ...descriptor,
    declaration: requirement,
    owner: capability,
    receiver: { kind: 'capability', declaration: capability },
  })
  const analysis: CallableAnalysis = Object.freeze({
    effects: { purity: { violations: [], open: false }, failures: { cases: [], open: false } },
    findings: [],
  })
  const context: AssociatedEffectsContext = {
    descriptors: new Map<
      AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
      AssociatedCallableDescriptor
    >([
      [method, descriptor],
      [requirement, requiredDescriptor],
    ]),
    analyses: new Map([[method, analysis]]),
  }
  return { owner, capability, method, requirement, descriptor, requiredDescriptor, analysis, context }
}
