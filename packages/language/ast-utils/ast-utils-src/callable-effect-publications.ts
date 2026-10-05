import { AST } from '@parser'
import { Assert } from '@shared'
import type { CallableEffectFactInputs, SourceDiscoveryContext } from './callable-effect-facts'
import {
  assertCanonicalEffectSnapshot,
  type CanonicalCallableDescriptor,
  type CanonicalEffectIndependentSnapshot,
  type CanonicalReadPublication,
} from './canonical-effect-snapshot'

export type CallableEffectPublications = Readonly<{
  inputs: CallableEffectFactInputs
  context: SourceDiscoveryContext
}>

/** Project factory-published identities into the existing, single source-discovery pass. */
export function projectCallableEffectPublications(
  snapshot: CanonicalEffectIndependentSnapshot,
  owner: AST.Node,
): CallableEffectPublications {
  assertCanonicalEffectSnapshot(snapshot)

  const foreignHeads = new Map(
    snapshot.natives.filter(native =>
      native.phase === 'evaluation' && native.declaration === native.exportSource
      && AST.isFunctionCallExpression(native.declaration)
      && AST.isFromExpression(native.declaration.$container)
      && native.declaration.$container.expression === native.declaration
    ).map(native => [native.declaration, native]),
  )
  const calls: CallableEffectFactInputs['calls'][number][] = []
  for (const [key, publication] of snapshot.calls) {
    Assert(key === publication.site, 'Expected canonical call inventory keys to match their sites.')
    Assert(
      AST.isFunctionCallExpression(publication.site) || AST.isMethodCallExpression(publication.site)
        || AST.isConversionExpression(publication.site) || AST.isBinaryExpression(publication.site)
        || AST.isUnaryExpression(publication.site),
      'Expected canonical calls to use a supported call site.',
    )
    const foreign = foreignHeads.get(publication.site)
    if (foreign) {
      calls.push(Object.freeze({
        site: publication.site,
        operation: publication.operation,
        pairs: Object.freeze([]),
        defaults: Object.freeze([]),
        ...(foreign.kind === 'complete'
          ? { kind: 'complete' as const }
          : { kind: 'unknown' as const, reason: foreign.reason }),
      }))
      continue
    }
    const descriptor = publication.descriptor
    const body = descriptor?.kind === 'source' ? descriptor.body : undefined
    const contract = descriptor && descriptor.kind !== 'source' ? descriptor.contract : undefined
    const defaults = publication.defaults.flatMap(value =>
      value.eligibility === 'cannot'
        ? []
        : [Object.freeze({ parameter: value.parameter, expression: value.expression })]
    )
    const incompleteDefault = publication.defaults.some(value => value.eligibility === 'unknown')
    const knownCallable = !!publication.target && !!descriptor && descriptor.declaration === publication.target
      && (!!body || !!contract)
    const complete = publication.kind === 'complete' && knownCallable && !incompleteDefault
      && (!descriptor || descriptor.pending.length === 0)
    const reason = publication.kind === 'unknown' ? publication.reason : 'incomplete-fact'
    calls.push(Object.freeze({
      site: publication.site,
      operation: publication.operation,
      ...(publication.target ? { target: publication.target } : {}),
      ...(body ? { body } : {}),
      ...(contract ? { contract } : {}),
      pairs: Object.freeze(publication.pairs.map(pair =>
        Object.freeze({
          argument: pair.argument,
          parameter: pair.parameter,
        })
      )),
      defaults: Object.freeze(defaults),
      ...(complete ? { kind: 'complete' as const } : { kind: 'unknown' as const, reason }),
    }))
  }

  // The factory promises rows for these exact syntax categories. Keep DoStatement outside this invariant.
  for (const node of snapshot.covered) {
    if (AST.isFunctionCallExpression(node) || AST.isMethodCallExpression(node) || AST.isConversionExpression(node)) {
      Assert(snapshot.calls.has(node), 'Expected every covered supported call to have a canonical publication.')
    }
  }

  const reads: CallableEffectFactInputs['reads'][number][] = []
  for (const [key, publication] of snapshot.reads) {
    Assert(key === publication.reference, 'Expected canonical read inventory keys to match their references.')
    Assert(
      AST.isValueReference(publication.reference) || AST.isMemberAccessExpression(publication.reference)
        || AST.isPostfixMemberAccess(publication.reference),
      'Expected canonical reads to use a supported read site.',
    )
    reads.push(projectRead(publication))
  }
  for (const node of snapshot.covered) {
    if (AST.isValueReference(node) || AST.isMemberAccessExpression(node)) {
      Assert(snapshot.reads.has(node), 'Expected every covered supported read to have a canonical publication.')
    } else if (
      AST.isPostfixMemberAccess(node)
      && AST.isMethodCallExpression(node.$container)
      && node.$container.callee === node
    ) {
      Assert(
        snapshot.reads.has(node),
        'Expected every covered method callee to have a canonical selection publication.',
      )
    }
  }

  const natives = snapshot.natives.map(publication =>
    Object.freeze({
      ...publication,
      purity: Object.freeze({
        violations: Object.freeze([...publication.purity.violations]),
        open: publication.purity.open,
      }),
      failures: Object.freeze({
        cases: Object.freeze([...publication.failures.cases]),
        open: publication.failures.open,
      }),
    })
  )
  const inputs: CallableEffectFactInputs = Object.freeze({
    calls: Object.freeze(calls),
    reads: Object.freeze(reads),
    natives: Object.freeze(natives),
  })

  const descriptor = snapshot.descriptors.get(owner)
  const root = descriptor && descriptor.declaration === owner
    ? projectSourceRoot(owner, descriptor)
    : undefined
  const context: SourceDiscoveryContext = Object.freeze({
    ...(root ? { root } : {}),
    covered: snapshot.covered,
  })
  return Object.freeze({ inputs, context })
}

function projectRead(publication: CanonicalReadPublication): CallableEffectFactInputs['reads'][number] {
  return Object.freeze({
    reference: publication.reference,
    classification: publication.classification,
    ...(publication.initializer ? { initializer: publication.initializer } : {}),
    ...(publication.kind === 'complete'
      ? { kind: 'complete' as const }
      : { kind: 'unknown' as const, reason: publication.reason }),
  })
}

function projectSourceRoot(owner: AST.Node, descriptor: CanonicalCallableDescriptor): SourceDiscoveryContext['root'] {
  const source = descriptor.kind === 'source' || AST.isPhraseDeclaration(owner)
  if (!source) {
    return undefined
  }
  const parameters = descriptor.parameters
  const defaults = parameters.flatMap(parameter =>
    parameter.defaultValue
      ? [Object.freeze({ parameter, expression: parameter.defaultValue })]
      : []
  )
  const body = descriptor.kind === 'source' ? descriptor.body : undefined
  const complete = descriptor.kind === 'source' && !!body && descriptor.pending.length === 0
  return Object.freeze({
    node: owner,
    bodies: Object.freeze(body ? [body] : []),
    defaults: Object.freeze(defaults),
    ...(complete ? { kind: 'complete' as const } : { kind: 'unknown' as const, reason: 'incomplete-fact' as const }),
  })
}
