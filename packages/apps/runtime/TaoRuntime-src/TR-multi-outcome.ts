import {
  captureActionContinuation,
  isPromiseLike,
  resumeActionContinuation,
  runActionScopeUser,
} from './TR-action-transactions'

type MultiOutcomeMatch<PayloadT> = Readonly<{ matched: boolean; payload: PayloadT }>
type MultiOutcomeBody<PayloadT, ResultT> = readonly [string, (payload: PayloadT) => ResultT | PromiseLike<ResultT>]

/** Capture every case observation before running all selected bodies in authored, joined order. */
export function runMultiOutcome<ObservationT, PayloadT, ResultT>(
  observe: () => ObservationT,
  match: (observation: ObservationT, caseName: string) => MultiOutcomeMatch<PayloadT>,
  branches: readonly MultiOutcomeBody<PayloadT, ResultT>[],
  otherwise?: () => ResultT | PromiseLike<ResultT>,
): Awaited<ResultT>[] | Promise<Awaited<ResultT>[]> {
  return runActionScopeUser(() => {
    const continuation = captureActionContinuation()
    const observation = observe()
    const selected = branches.flatMap(([caseName, body]) => {
      const { matched, payload } = match(observation, caseName)
      return matched ? [() => body(payload)] : []
    })
    if (selected.length === 0 && otherwise) {
      selected.push(otherwise)
    }
    const results: Awaited<ResultT>[] = []
    const runFrom = (start: number): Awaited<ResultT>[] | Promise<Awaited<ResultT>[]> => {
      resumeActionContinuation(continuation)
      for (let index = start; index < selected.length; index++) {
        const result = selected[index]!()
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(settled => {
            resumeActionContinuation(continuation)
            results.push(settled)
            return runFrom(index + 1)
          })
        }
        results.push(result as Awaited<ResultT>)
      }
      return results
    }
    return runFrom(0)
  })
}
