import { Type } from './Type'

export type MatchGraph<Candidate, Target> = {
  targetsByCandidate: Map<Candidate, Target[]>
  candidatesByTarget: Map<Target, Candidate[]>
}

export function bindUnambiguousPairs<Candidate, Target>(params: {
  candidates: Set<Candidate>
  targets: Set<Target>
  isCandidateBlocked: (candidate: Candidate) => boolean
  matches: (candidate: Candidate, target: Target) => boolean
  bind: (candidate: Candidate, target: Target) => void
}): void {
  let madeProgress = true
  while (madeProgress) {
    madeProgress = false
    const graph = matchGraph(params.candidates, params.targets, params.isCandidateBlocked, params.matches)
    for (const [candidate, targets] of graph.targetsByCandidate) {
      if (targets.length !== 1) {
        continue
      }
      const target = targets[0]!
      if (graph.candidatesByTarget.get(target)?.length !== 1) {
        continue
      }
      params.bind(candidate, target)
      madeProgress = true
    }
  }
}

export function matchGraph<Candidate, Target>(
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

export function typesExactlyMatch(
  actual: ReturnType<typeof Type.ofExpression>,
  expected: ReturnType<typeof Type.ofParameter>,
): boolean {
  const actualKey = Type.identityKey(actual)
  return !!actualKey && actualKey === Type.identityKey(expected)
}
