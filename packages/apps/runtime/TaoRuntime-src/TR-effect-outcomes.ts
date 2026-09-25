import { isPromiseLike, skippedActionRun, takeActionSavepoint } from './TR-action-transactions'
import { actionFailureMessage, asActionFailure, TaoActionFailure } from './TR-errors'

/**
 * TaoEffectOutcome pairs one named outcome — `saved`, `rejected`, `error`, or a case — with its block,
 * which receives the selected user message (empty for `saved`).
 */
type TaoEffectOutcome = readonly [string, (message: string) => unknown]

/** TaoEffectContract is what the compiler knows about the verb a `when do` runs. */
export type TaoEffectContract = Readonly<{
  /**
   * declared lists the verb's effective failure cases; any other failure is an `error`. It is `null`
   * for a dynamic verb, whose contract the compiler cannot know: every declared failure it raises then
   * counts as `rejected`, and only an undeclared throw is an `error`.
   */
  declared: readonly string[] | null
  /** name is the verb a fallback message names. */
  name: string
}>

/**
 * runEffectOutcome runs one `when do`. The verb joins the caller's transaction as `do` does, but its
 * failure stops here: the overlays go back to the savepoint taken before it ran, so the verb's own
 * writes vanish while the caller's earlier writes stay, and the outcome the site names runs next. A
 * failure the site names no outcome for leaves exactly as a plain `do` failure would, aborting the
 * whole root; a handled one publishes no failure report, because the site already said what happens.
 * A `runs latest` call a newer one superseded never ran, so it runs no outcome at all.
 */
export function runEffectOutcome(
  invoke: () => unknown,
  contract: TaoEffectContract,
  outcomes: readonly TaoEffectOutcome[],
): unknown {
  const restore = takeActionSavepoint()
  const failed = (error: unknown): unknown => {
    restore()
    const failure = asActionFailure(error)
    const handler = failureOutcome(failure, error instanceof TaoActionFailure, contract, outcomes)
    if (!handler) {
      throw error
    }
    return handler(actionFailureMessage(failure, contract.name))
  }
  const saved = (): unknown => outcomeNamed('saved', outcomes)?.('')
  let result: unknown
  try {
    result = invoke()
  } catch (error) {
    return failed(error)
  }
  if (!isPromiseLike(result)) {
    return saved()
  }
  return Promise.resolve(result).then(settled => settled === skippedActionRun ? undefined : saved(), failed)
}

/**
 * failureOutcome picks the named case, then `rejected` for any declared case, then `error`. With an
 * unknown contract any deliberate action failure counts as declared, since the site cannot tell.
 */
function failureOutcome(
  failure: TaoActionFailure,
  deliberate: boolean,
  contract: TaoEffectContract,
  outcomes: readonly TaoEffectOutcome[],
): TaoEffectOutcome[1] | undefined {
  const declared = contract.declared === null ? deliberate : contract.declared.includes(failure.caseName)
  if (!declared) {
    return outcomeNamed('error', outcomes)
  }
  return outcomeNamed(failure.caseName, outcomes) ?? outcomeNamed('rejected', outcomes)
}

function outcomeNamed(name: string, outcomes: readonly TaoEffectOutcome[]): TaoEffectOutcome[1] | undefined {
  return outcomes.find(([outcome]) => outcome === name)?.[1]
}
