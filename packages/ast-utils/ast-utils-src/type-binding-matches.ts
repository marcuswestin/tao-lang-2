import { type TaoType, Type } from './Type'

/**
 * One binding algorithm serves render arguments, item constructor properties, and data writes. Each
 * caller supplies the vocabulary — how a candidate is labelled, how a target is named, what type each
 * side has, and which adjustments its domain makes between the named pass and the typed passes — and
 * gets back pairs in target order plus generic diagnostics it maps onto its own diagnostic union.
 *
 * The passes, in order:
 * 1. Named binding: every labelled candidate binds to the target of that name, or reports why not.
 * 2. The domain's own adjustment (`afterNamedBinding`): drop targets that must be named, bind by identity.
 * 3. Duplicate-type reports: targets that share a type cannot be told apart, nor can candidates.
 * 4. Typed binding: exact type identity first, then assignability, each until no unambiguous pair remains.
 * 5. What is left is reported as ambiguous, unmatched, or missing.
 */
export type BindingDiagnostic<Candidate, Target> =
  | { kind: 'duplicate-target-type'; target: Target; type: string }
  | { kind: 'duplicate-candidate-type'; candidate: Candidate; type: string }
  | { kind: 'unknown-named'; candidate: Candidate; name: string }
  | { kind: 'duplicate-named'; candidate: Candidate; target: Target }
  | { kind: 'named-type'; candidate: Candidate; target: Target }
  | { kind: 'ambiguous-candidate'; candidate: Candidate; targets: readonly Target[] }
  | { kind: 'ambiguous-target'; target: Target; candidates: readonly Candidate[] }
  | { kind: 'unmatched'; candidate: Candidate }
  | { kind: 'missing'; target: Target }

/** BindingState is the mutable middle of a resolution, handed to a domain's `afterNamedBinding`. */
export type BindingState<Candidate, Target> = {
  remainingCandidates: Set<Candidate>
  remainingTargets: Set<Target>
  bind(candidate: Candidate, target: Target): void
}

export type BindingRules<Candidate, Target> = {
  candidates: readonly Candidate[]
  /** The targets a candidate may bind to, in declaration order. */
  targets: readonly Target[]
  /** The order pairs come back in; defaults to `targets`. Wider when some targets were pre-filtered. */
  targetOrder?: readonly Target[]
  candidateLabel(candidate: Candidate): string | undefined
  targetName(target: Target): string
  candidateType(candidate: Candidate): TaoType
  targetType(target: Target): TaoType
  /** Whether a named candidate's value may take its target: assignability for arguments, cast compatibility for values. */
  namedTypeAccepts(actual: TaoType, expected: TaoType): boolean
  afterNamedBinding?(state: BindingState<Candidate, Target>): void
  /** Report targets that share a type only while unlabelled candidates remain to be told apart by type. */
  duplicateTargetTypesOnlyWithCandidates?: boolean
  /** A target that needs no value is never reported missing; defaults to every target. */
  targetRequiresValue?(target: Target): boolean
  /** Whether an unresolved candidate stands in for one missing target rather than leaving it reported. */
  unresolvedCandidatesExcuseMissing: boolean
}

export type BindingResolution<Candidate, Target> = {
  pairs: readonly (readonly [Candidate, Target])[]
  diagnostics: BindingDiagnostic<Candidate, Target>[]
}

/** resolveBindings binds candidates to targets by name, then by unambiguous type, and reports the rest. */
export function resolveBindings<Candidate, Target>(
  rules: BindingRules<Candidate, Target>,
): BindingResolution<Candidate, Target> {
  const diagnostics: BindingDiagnostic<Candidate, Target>[] = []
  const pairs: (readonly [Candidate, Target])[] = []
  const remainingCandidates = new Set(rules.candidates)
  const remainingTargets = new Set(rules.targets)
  const bind = (candidate: Candidate, target: Target): void => {
    pairs.push([candidate, target])
    remainingCandidates.delete(candidate)
    remainingTargets.delete(target)
  }

  bindNamed(rules, { bind, remainingCandidates, remainingTargets }, pairs, diagnostics)
  rules.afterNamedBinding?.({ bind, remainingCandidates, remainingTargets })

  if (rules.duplicateTargetTypesOnlyWithCandidates !== true || remainingCandidates.size > 0) {
    reportDuplicateTargetTypes(rules, [...remainingTargets], diagnostics)
  }
  const duplicateCandidateTypes = reportDuplicateCandidateTypes(rules, [...remainingCandidates], diagnostics)
  const blocked = (candidate: Candidate): boolean => {
    const key = Type.identityKey(rules.candidateType(candidate))
    return !!key && duplicateCandidateTypes.has(key)
  }
  const assignable = (candidate: Candidate, target: Target): boolean =>
    Type.isAssignable(rules.candidateType(candidate), rules.targetType(target))
  bindUnambiguousPairs(remainingCandidates, remainingTargets, blocked, (candidate, target) => {
    const actualKey = Type.identityKey(rules.candidateType(candidate))
    return !!actualKey && actualKey === Type.identityKey(rules.targetType(target))
  }, bind)
  bindUnambiguousPairs(remainingCandidates, remainingTargets, blocked, assignable, bind)

  reportRemaining(rules, remainingCandidates, remainingTargets, duplicateCandidateTypes, assignable, diagnostics)

  const order = rules.targetOrder ?? rules.targets
  return {
    // Bindings follow type, not source position; pairs come back in the target's declared order so
    // codegen emits props, fields, and callback arguments in the callee's order.
    pairs: pairs.toSorted((left, right) => order.indexOf(left[1]) - order.indexOf(right[1])),
    diagnostics,
  }
}

function bindNamed<Candidate, Target>(
  rules: BindingRules<Candidate, Target>,
  state: BindingState<Candidate, Target>,
  pairs: readonly (readonly [Candidate, Target])[],
  diagnostics: BindingDiagnostic<Candidate, Target>[],
): void {
  for (const candidate of [...state.remainingCandidates]) {
    const name = rules.candidateLabel(candidate)
    if (!name) {
      continue
    }
    const target = [...state.remainingTargets].find(candidateTarget => rules.targetName(candidateTarget) === name)
    if (!target) {
      const declared = pairs.find(pair => rules.targetName(pair[1]) === name)?.[1]
      diagnostics.push(
        declared
          ? { kind: 'duplicate-named', candidate, target: declared }
          : { kind: 'unknown-named', candidate, name },
      )
      state.remainingCandidates.delete(candidate)
      continue
    }
    const actual = rules.candidateType(candidate)
    const expected = rules.targetType(target)
    if (actual.kind !== 'unresolved' && expected.kind !== 'unresolved' && !rules.namedTypeAccepts(actual, expected)) {
      diagnostics.push({ kind: 'named-type', candidate, target })
    }
    state.bind(candidate, target)
  }
}

function reportDuplicateTargetTypes<Candidate, Target>(
  rules: BindingRules<Candidate, Target>,
  targets: readonly Target[],
  diagnostics: BindingDiagnostic<Candidate, Target>[],
): void {
  const seen = new Set<string>()
  for (const target of targets) {
    const key = Type.identityKey(rules.targetType(target))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      diagnostics.push({ kind: 'duplicate-target-type', target, type: key })
      continue
    }
    seen.add(key)
  }
}

function reportDuplicateCandidateTypes<Candidate, Target>(
  rules: BindingRules<Candidate, Target>,
  candidates: readonly Candidate[],
  diagnostics: BindingDiagnostic<Candidate, Target>[],
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const candidate of candidates) {
    if (rules.candidateLabel(candidate)) {
      continue
    }
    const key = Type.identityKey(rules.candidateType(candidate))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      duplicates.add(key)
      diagnostics.push({ kind: 'duplicate-candidate-type', candidate, type: key })
      continue
    }
    seen.add(key)
  }
  return duplicates
}

type MatchGraph<Candidate, Target> = {
  targetsByCandidate: Map<Candidate, Target[]>
  candidatesByTarget: Map<Target, Candidate[]>
}

/** bindUnambiguousPairs binds every candidate that matches exactly one target that matches only it, until none is left. */
function bindUnambiguousPairs<Candidate, Target>(
  candidates: Set<Candidate>,
  targets: Set<Target>,
  isCandidateBlocked: (candidate: Candidate) => boolean,
  matches: (candidate: Candidate, target: Target) => boolean,
  bind: (candidate: Candidate, target: Target) => void,
): void {
  let madeProgress = true
  while (madeProgress) {
    madeProgress = false
    const graph = matchGraph(candidates, targets, isCandidateBlocked, matches)
    for (const [candidate, matchedTargets] of graph.targetsByCandidate) {
      if (matchedTargets.length !== 1) {
        continue
      }
      const target = matchedTargets[0]!
      if (graph.candidatesByTarget.get(target)?.length !== 1) {
        continue
      }
      bind(candidate, target)
      madeProgress = true
    }
  }
}

function matchGraph<Candidate, Target>(
  candidates: Set<Candidate>,
  targets: Set<Target>,
  isCandidateBlocked: (candidate: Candidate) => boolean,
  matches: (candidate: Candidate, target: Target) => boolean,
): MatchGraph<Candidate, Target> {
  const targetsByCandidate = new Map<Candidate, Target[]>()
  const candidatesByTarget = new Map<Target, Candidate[]>()
  for (const candidate of candidates) {
    if (isCandidateBlocked(candidate)) {
      continue
    }
    const matchedTargets = Array.from(targets).filter(target => matches(candidate, target))
    if (matchedTargets.length === 0) {
      continue
    }
    targetsByCandidate.set(candidate, matchedTargets)
    for (const target of matchedTargets) {
      const matchedCandidates = candidatesByTarget.get(target) ?? []
      matchedCandidates.push(candidate)
      candidatesByTarget.set(target, matchedCandidates)
    }
  }
  return { targetsByCandidate, candidatesByTarget }
}

function reportRemaining<Candidate, Target>(
  rules: BindingRules<Candidate, Target>,
  remainingCandidates: Set<Candidate>,
  remainingTargets: Set<Target>,
  duplicateCandidateTypes: ReadonlySet<string>,
  assignable: (candidate: Candidate, target: Target) => boolean,
  diagnostics: BindingDiagnostic<Candidate, Target>[],
): void {
  const isDuplicateType = (candidate: Candidate): boolean => {
    const key = Type.identityKey(rules.candidateType(candidate))
    return !!key && duplicateCandidateTypes.has(key)
  }
  const graph = matchGraph(
    remainingCandidates,
    remainingTargets,
    candidate => rules.candidateType(candidate).kind === 'unresolved' || isDuplicateType(candidate),
    assignable,
  )
  const ambiguousCandidates = new Set<Candidate>()
  const ambiguousTargets = new Set<Target>()
  let unresolvedCandidates = 0
  for (const candidate of remainingCandidates) {
    if (rules.candidateType(candidate).kind === 'unresolved') {
      unresolvedCandidates += 1
      continue
    }
    if (isDuplicateType(candidate)) {
      continue
    }
    const targets = graph.targetsByCandidate.get(candidate) ?? []
    if (targets.length > 1) {
      diagnostics.push({ kind: 'ambiguous-candidate', candidate, targets })
      ambiguousCandidates.add(candidate)
      targets.forEach(target => ambiguousTargets.add(target))
    }
  }
  for (const [target, candidates] of graph.candidatesByTarget) {
    if (candidates.length > 1) {
      diagnostics.push({ kind: 'ambiguous-target', target, candidates })
      ambiguousTargets.add(target)
      candidates.forEach(candidate => ambiguousCandidates.add(candidate))
    }
  }
  for (const candidate of remainingCandidates) {
    if (ambiguousCandidates.has(candidate)) {
      continue
    }
    const unmatched = rules.candidateType(candidate).kind !== 'unresolved'
      && !isDuplicateType(candidate)
      && !(graph.targetsByCandidate.get(candidate)?.length)
    if (unmatched) {
      diagnostics.push({ kind: 'unmatched', candidate })
    }
  }
  for (const target of remainingTargets) {
    if (ambiguousTargets.has(target)) {
      continue
    }
    if (rules.unresolvedCandidatesExcuseMissing && unresolvedCandidates > 0) {
      unresolvedCandidates -= 1
      continue
    }
    if (rules.targetRequiresValue?.(target) === false) {
      continue
    }
    diagnostics.push({ kind: 'missing', target })
  }
}
