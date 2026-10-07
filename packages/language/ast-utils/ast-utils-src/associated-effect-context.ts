import { AST } from '@parser'
import {
  type AssociatedCallableDeclaration,
  type AssociatedCallableDescriptor,
  type AssociatedEffectsContext,
  capabilityCallableRequirements,
  ownAssociatedActions,
  ownAssociatedMethods,
  ownAssociatedViews,
} from './associated-methods'
import type { NativeEffectPublication } from './callable-effect-facts'
import { projectCallableEffectPublications } from './callable-effect-publications'
import { analyzeCallableEffects, type CallableAnalysis, type PurityContract } from './callable-effects'
import { publishCanonicalEffectSnapshot } from './canonical-effect-snapshot'
import { effectFailureContract } from './effect-outcomes'
import { declaredCallableFailureContract, type FailureContract } from './failure-contracts'
import { mountedViewCreationAnalysis } from './mounted-view-creation'
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
      || (!AST.isPrimitiveDeclaration(owner) && ownAssociatedActions(owner).length > 0)
      || (AST.isTypeDeclaration(owner) && capabilityCallableRequirements(owner).length > 0)
    )
  )
  const descriptors = new Map<
    AssociatedCallableDeclaration,
    AssociatedCallableDescriptor
  >()
  const analyses = new Map<AST.Node, CallableAnalysis>()
  const creatorAnalyses = new Map<AST.AssociatedViewDeclaration, CallableAnalysis>()
  const requirements = new Map<
    AST.CapabilityMethodDeclaration | AST.CapabilityActionDeclaration,
    Readonly<{ purity: PurityContract; failures: FailureContract }>
  >()
  for (const owner of owners) {
    if (!AST.isTypeDeclaration(owner)) {
      continue
    }
    for (const method of capabilityCallableRequirements(owner)) {
      const contract = Type.associatedCallable(method, owner)
      requirements.set(method, {
        // A function requirement excludes actions, I/O, suspension and reactive-state reads.
        purity: { open: false, violations: AST.isCapabilityActionDeclaration(method) ? ['action'] : [] },
        failures: contract.kind === 'ready' ? contract.descriptor.signature.failures : { open: true, cases: [] },
      })
    }
  }
  const natives: NativeEffectPublication[] = []
  for (const file of files) {
    for (const declaration of AST.streamAllContents(file)) {
      if (AST.isActionDeclaration(declaration) && declaration.foreign) {
        natives.push({
          declaration,
          exportSource: declaration,
          phase: 'invocation',
          kind: 'complete',
          purity: { violations: ['action', 'io', 'suspend'], open: false },
          failures: effectFailureContract(declaration),
        })
        continue
      }
      if (
        !AST.isFunctionDeclaration(declaration) && !AST.isAssociatedFunctionDeclaration(declaration)
        && !AST.isAssociatedConverterDeclaration(declaration)
      ) {
        continue
      }
      if (!AST.isAssociatedConverterDeclaration(declaration) && !declaration.returnType) {
        continue
      }
      const failures: FailureContract = AST.isAssociatedConverterDeclaration(declaration)
        ? Type.associatedConverterDescriptor(declaration)?.signature.failures ?? { cases: [], open: true }
        : declaredCallableFailureContract(declaration)
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
          failures,
        })
      }
    }
  }
  const snapshot = publishCanonicalEffectSnapshot(files, { requirements, natives })
  for (const [method, contract] of snapshot.associatedDescriptors) {
    if (contract.kind === 'ready') {
      descriptors.set(method, contract.descriptor)
    }
    if (AST.isAssociatedViewDeclaration(method)) {
      const creator = mountedViewCreationAnalysis(snapshot, method)
      if (creator) {
        creatorAnalyses.set(method, creator)
      }
    }
  }
  for (const declaration of snapshot.descriptors.keys()) {
    if (
      AST.isAssociatedFunctionDeclaration(declaration) || AST.isAssociatedConverterDeclaration(declaration)
      || AST.isFunctionDeclaration(declaration) || AST.isAssociatedViewDeclaration(declaration)
      || AST.isActionDeclaration(declaration)
    ) {
      const publication = projectCallableEffectPublications(snapshot, declaration)
      const facts = publication.discoverFacts(declaration, publication.context)
      const analysis = analyzeCallableEffects(declaration, facts)
      // Action failure discovery owns joined outcomes, deferred cleanup and detached execution.
      // Seal its effective contract alongside the independent purity discovery before admission.
      analyses.set(
        declaration,
        AST.isActionDeclaration(declaration)
          ? Object.freeze({
            ...analysis,
            effects: Object.freeze({ ...analysis.effects, failures: effectFailureContract(declaration) }),
          })
          : analysis,
      )
    }
  }
  return Object.freeze({ descriptors, analyses, creatorAnalyses })
}
