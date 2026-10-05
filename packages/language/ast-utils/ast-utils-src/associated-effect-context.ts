import { AST } from '@parser'
import {
  type AssociatedCallableDescriptor,
  type AssociatedEffectsContext,
  capabilityRequirements,
  ownAssociatedMethods,
} from './associated-methods'
import { discoverCallableEffectFacts } from './callable-effect-facts'
import { projectCallableEffectPublications } from './callable-effect-publications'
import { analyzeCallableEffects, type CallableAnalysis, type PurityContract } from './callable-effects'
import { publishCanonicalEffectSnapshot } from './canonical-effect-snapshot'
import type { FailureContract } from './failure-contracts'
import { Type } from './Type'

/** Materialize correspondence, discover real source effects, then seal final structural admission. */
export function createAssociatedEffects(files: readonly AST.TaoFile[]): AssociatedEffectsContext {
  const owners = files.flatMap(file =>
    AST.streamAllContents(file).filter(AST.isTypeDeclaration).filter(owner =>
      ownAssociatedMethods(owner).length > 0 || capabilityRequirements(owner).length > 0
    )
  )
  const descriptors = new Map<
    AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
    AssociatedCallableDescriptor
  >()
  const analyses = new Map<AST.Node, CallableAnalysis>()
  if (owners.length === 0) {
    return Object.freeze({ descriptors, analyses })
  }
  const requirements = new Map<
    AST.CapabilityMethodDeclaration,
    Readonly<{ purity: PurityContract; failures: FailureContract }>
  >()
  for (const owner of owners) {
    for (const method of capabilityRequirements(owner)) {
      const contract = Type.associatedCallable(method, owner)
      requirements.set(method, {
        // A function requirement excludes actions, I/O, suspension and reactive-state reads.
        purity: { open: false, violations: [] },
        failures: contract.kind === 'ready' ? contract.descriptor.signature.failures : { open: true, cases: [] },
      })
    }
  }
  // Native exports remain unknown unless independently attested by their owning bridge contract.
  const snapshot = publishCanonicalEffectSnapshot(files, { requirements })
  for (const [method, contract] of snapshot.associatedDescriptors) {
    if (contract.kind === 'ready') {
      descriptors.set(method, contract.descriptor)
    }
    if (AST.isAssociatedFunctionDeclaration(method)) {
      const publication = projectCallableEffectPublications(snapshot, method)
      const facts = discoverCallableEffectFacts(method, publication.inputs, publication.context)
      analyses.set(method, analyzeCallableEffects(method, facts))
    }
  }
  return Object.freeze({ descriptors, analyses })
}
