import {
  captureActionContinuation,
  isPromiseLike,
  resumeActionContinuation,
  runActionScopeUser,
  skippedActionRun,
  takeActionSavepoint,
} from './TR-action-transactions'
import { actionExitOf, actionFailureMessage, asActionFailure, TaoActionFailure } from './TR-errors'

/**
 * TaoEffectOutcome pairs one named outcome — `saved`, `rejected`, `error`, or a case — with its block,
 * which receives the selected user message (empty for `saved`).
 */
type TaoEffectOutcome<PayloadT = string> = readonly [string, (payload: PayloadT) => unknown]

/** Canonical failure binders are ordinary Tao records with the selected user-facing sentence. */
type TaoJoinedEffectFailure = Readonly<{ Message: string }>

type OutcomeProtocol<PayloadT> = Readonly<{
  success: string
  broadError: boolean
  successPayload: (result: unknown) => PayloadT
  failurePayload: (message: string) => PayloadT
}>

/** TaoEffectContract is what the compiler knows about the verb a `when do` runs. */
export type TaoEffectContract = Readonly<{
  /**
   * declared lists the verb's known effective failure cases. Legacy `null` contracts are open.
   */
  declared: readonly string[] | null
  /** An open contract also accepts other deliberate action failures, but never arbitrary throws. */
  open?: boolean
  /** name is the verb a fallback message names. */
  name: string
  /** Authentication completes a flow; it does not acknowledge a saved data write. */
  success?: 'completed' | 'saved'
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
  return runActionScopeUser(() =>
    runContainedEffectOutcome(invoke, contract, outcomes, {
      success: contract.success ?? 'saved',
      broadError: false,
      successPayload: () => '',
      failurePayload: message => message,
    })
  )
}

/** Canonical `then` joins its handler, forwards the result to `done`, and gives failures a record. */
export function runJoinedEffectOutcome(
  invoke: () => unknown,
  contract: TaoEffectContract,
  outcomes: readonly TaoEffectOutcome<unknown>[],
): unknown {
  return runActionScopeUser(() =>
    runContainedEffectOutcome(invoke, contract, outcomes, {
      success: 'done',
      broadError: true,
      successPayload: result => result,
      failurePayload: (message): TaoJoinedEffectFailure => Object.freeze({ Message: message }),
    })
  )
}

function runContainedEffectOutcome<PayloadT>(
  invoke: () => unknown,
  contract: TaoEffectContract,
  outcomes: readonly TaoEffectOutcome<PayloadT>[],
  protocol: OutcomeProtocol<PayloadT>,
): unknown {
  const continuation = captureActionContinuation()
  const restore = takeActionSavepoint()
  const failed = (error: unknown): unknown => {
    resumeActionContinuation(continuation)
    restore()
    const exit = actionExitOf(error)
    const primary = exit ? exit.primary : error
    const failure = asActionFailure(error)
    const handler =
      failureOutcome(failure, primary instanceof TaoActionFailure, contract, outcomes, protocol.broadError)
        ?? outcomeNamed('otherwise', outcomes)
    if (!handler) {
      throw error
    }
    return handler(protocol.failurePayload(actionFailureMessage(failure, contract.name, exit?.stage)))
  }
  const saved = (result: unknown): unknown => {
    resumeActionContinuation(continuation)
    return (outcomeNamed(protocol.success, outcomes) ?? outcomeNamed('otherwise', outcomes))?.(
      protocol.successPayload(result),
    )
  }
  let result: unknown
  try {
    result = invoke()
  } catch (error) {
    return failed(error)
  }
  if (!isPromiseLike(result)) {
    return saved(result)
  }
  return Promise.resolve(result).then(settled => settled === skippedActionRun ? undefined : saved(settled), failed)
}

/**
 * failureOutcome picks the named case, then `rejected` for a declared case, then `error`. An open
 * remainder accepts other deliberate action failures without treating arbitrary throws as modeled.
 */
function failureOutcome<PayloadT>(
  failure: TaoActionFailure,
  deliberate: boolean,
  contract: TaoEffectContract,
  outcomes: readonly TaoEffectOutcome<PayloadT>[],
  broadError: boolean,
): TaoEffectOutcome<PayloadT>[1] | undefined {
  if (broadError) {
    return (deliberate ? outcomeNamed(failure.caseName, outcomes) : undefined) ?? outcomeNamed('error', outcomes)
  }
  const declared = deliberate && (
    contract.declared?.includes(failure.caseName) === true || contract.open === true || contract.declared === null
  )
  if (!declared) {
    return outcomeNamed('error', outcomes)
  }
  return outcomeNamed(failure.caseName, outcomes) ?? outcomeNamed('rejected', outcomes)
}

function outcomeNamed<PayloadT>(
  name: string,
  outcomes: readonly TaoEffectOutcome<PayloadT>[],
): TaoEffectOutcome<PayloadT>[1] | undefined {
  return outcomes.find(([outcome]) => outcome === name)?.[1]
}
