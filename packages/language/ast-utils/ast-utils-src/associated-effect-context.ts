import { AST } from '@parser'
import {
  type AssociatedCallableDeclaration,
  type AssociatedCallableDescriptor,
  type AssociatedEffectsContext,
  capabilityRequirements,
  ownAssociatedMethods,
  ownAssociatedViews,
} from './associated-methods'
import { discoverCallableEffectFacts, type NativeEffectPublication } from './callable-effect-facts'
import { projectCallableEffectPublications } from './callable-effect-publications'
import { analyzeCallableEffects, type CallableAnalysis, type PurityContract } from './callable-effects'
import { publishCanonicalEffectSnapshot } from './canonical-effect-snapshot'
import type { FailureContract } from './failure-contracts'
import { Type } from './Type'

/** Materialize correspondence, discover real source effects, then seal final structural admission. */
export function createAssociatedEffects(files: readonly AST.TaoFile[]): AssociatedEffectsContext {
  const owners = files.flatMap(file =>
    AST.streamAllContents(file).filter((
      node,
    ): node is AST.TypeDeclaration | AST.PrimitiveDeclaration | AST.EntityDataDeclaration =>
      AST.isTypeDeclaration(node) || AST.isPrimitiveDeclaration(node) || AST.isEntityDataDeclaration(node)
    ).filter(owner =>
      ownAssociatedMethods(owner).length > 0 || ownAssociatedViews(owner).length > 0
      || (AST.isTypeDeclaration(owner) && capabilityRequirements(owner).length > 0)
    )
  )
  const descriptors = new Map<
    AssociatedCallableDeclaration,
    AssociatedCallableDescriptor
  >()
  const analyses = new Map<AST.Node, CallableAnalysis>()
  const requirements = new Map<
    AST.CapabilityMethodDeclaration,
    Readonly<{ purity: PurityContract; failures: FailureContract }>
  >()
  for (const owner of owners) {
    if (!AST.isTypeDeclaration(owner)) {
      continue
    }
    for (const method of capabilityRequirements(owner)) {
      const contract = Type.associatedCallable(method, owner)
      requirements.set(method, {
        // A function requirement excludes actions, I/O, suspension and reactive-state reads.
        purity: { open: false, violations: [] },
        failures: contract.kind === 'ready' ? contract.descriptor.signature.failures : { open: true, cases: [] },
      })
    }
  }
  const natives: NativeEffectPublication[] = []
  for (const file of files) {
    for (const declaration of AST.streamAllContents(file)) {
      if (
        !AST.isFunctionDeclaration(declaration) && !AST.isAssociatedFunctionDeclaration(declaration)
        && !AST.isAssociatedConverterDeclaration(declaration)
      ) {
        continue
      }
      if (!AST.isAssociatedConverterDeclaration(declaration) && !declaration.returnType) {
        continue
      }
      for (const statement of AST.returnStatementsOf(declaration)) {
        const bridge = statement.value
        if (!AST.isFromExpression(bridge) || !AST.isFunctionCallExpression(bridge.expression)) {
          continue
        }
        // A declared pure wrapper trusts its foreign head, independently of argument/default evaluation.
        natives.push({
          declaration: bridge.expression,
          exportSource: bridge.expression,
          phase: 'evaluation',
          kind: 'complete',
          purity: { violations: [], open: false },
          failures: { cases: [], open: true },
        })
      }
    }
  }
  const snapshot = publishCanonicalEffectSnapshot(files, { requirements, natives })
  for (const [method, contract] of snapshot.associatedDescriptors) {
    if (contract.kind === 'ready') {
      descriptors.set(method, contract.descriptor)
    }
  }
  for (const declaration of snapshot.descriptors.keys()) {
    if (
      AST.isAssociatedFunctionDeclaration(declaration) || AST.isAssociatedConverterDeclaration(declaration)
      || AST.isFunctionDeclaration(declaration)
    ) {
      const publication = projectCallableEffectPublications(snapshot, declaration)
      const facts = discoverCallableEffectFacts(declaration, publication.inputs, publication.context)
      analyses.set(declaration, analyzeCallableEffects(declaration, facts))
    }
  }
  return Object.freeze({ descriptors, analyses })
}
