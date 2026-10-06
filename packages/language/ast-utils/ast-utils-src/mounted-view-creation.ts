import { AST } from '@parser'
import { analyzeCallableEffects, type CallableAnalysis } from './callable-effects'
import { assertCanonicalEffectSnapshot, type CanonicalEffectIndependentSnapshot } from './canonical-effect-snapshot'

/**
 * The mounted convention constructs an opaque rendered descriptor from already-bound values.
 * Its body, parameter defaults, hooks and events execute at mount, outside this creation graph.
 */
export function mountedViewCreationAnalysis(
  snapshot: CanonicalEffectIndependentSnapshot,
  declaration: AST.AssociatedViewDeclaration,
): CallableAnalysis | undefined {
  assertCanonicalEffectSnapshot(snapshot)
  const source = snapshot.descriptors.get(declaration)
  const associated = snapshot.associatedDescriptors.get(declaration)
  if (
    source?.declaration !== declaration || source.kind !== 'source' || source.convention !== 'mounted'
    || source.pending.length > 0 || associated?.kind !== 'ready'
    || associated.descriptor.declaration !== declaration
  ) {
    return undefined
  }
  return analyzeCallableEffects(declaration, [{
    kind: 'complete',
    node: declaration,
    purity: { violations: [], open: false },
    failures: { cases: [], open: false },
    executes: [],
  }])
}
