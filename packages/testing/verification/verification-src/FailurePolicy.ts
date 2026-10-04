import { FlakeTolerance } from './FlakeTolerance'
import { describesTimeout } from './RunSummary'
import { TestLedger } from './TestLedger'
import type { TestNodeState } from './TestNodes'
import type { WorkState } from './WorkGraph'

/** Broad work stops on a definite failure; an explicit diagnostic scope collects its failures. */
export type FailurePolicy = 'fail-fast' | 'collect-all'

type TestRequest = {
  evidenceMode?: 'mutation'
  kind: 'full' | 'changed' | 'file' | 'retry'
  pattern?: string
}

function forTests(request: TestRequest, repositoryRootTarget = false): FailurePolicy {
  const diagnostic = request.evidenceMode === 'mutation'
    || request.kind === 'retry'
    || (request.pattern ?? '').length > 0
    || (request.kind === 'file' && !repositoryRootTarget)
  return diagnostic ? 'collect-all' : 'fail-fast'
}

/** One tolerance snapshot serves both the early stop decision and the final verdict. */
function create(options: {
  observe: (states: readonly TestNodeState[], repositoryRoot: string) => Promise<unknown>
  policy: FailurePolicy
  repositoryRoot: string
  tests: readonly TestNodeState[]
}) {
  let tolerance: ReturnType<typeof TestLedger.tolerated> | undefined
  const tolerated = () => tolerance ??= TestLedger.tolerated(options.repositoryRoot)
  const tests = new Map(options.tests.map(test => [test.name, test]))
  const stopOnFailure = options.policy === 'collect-all' ? undefined : async (state: WorkState) => {
    // A timeout can still be confirmed in isolation after running work drains.
    if (
      state.failure?.kind === 'timeout'
      || state.failure?.kind === 'interrupted'
      || describesTimeout(state.reason ?? '')
      || describesTimeout(state.fullOutput)
    ) {
      return false
    }
    const test = tests.get(state.name)
    if (test === undefined) {
      return true
    }
    await options.observe([test], options.repositoryRoot)
    return !FlakeTolerance.apply([test], await tolerated()).nodes.has(test.name)
  }
  return { stopOnFailure, tolerated }
}

export const FailurePolicy = { create, forTests }
