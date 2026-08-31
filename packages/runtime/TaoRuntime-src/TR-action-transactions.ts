import { reportUnownedFailure } from './TR-errors'
import { registerRuntimeCaptureDomain, type TaoRuntimeJson } from './TR-runtime-capture'

export type TaoDeclaredFailure = Readonly<{
  case: { evaluate(): { jsValue: unknown } }
  sentence: string
}>

export type TaoActionFailureReport = Readonly<{
  action: string
  arguments: readonly unknown[]
  case: string
  message: string
  retryEligible: boolean
  frames: readonly string[]
  timestamp: number
}>

type TransactionResource<ValueT> = {
  commit(value: ValueT): void
  prepare?(value: ValueT): void
  rollbackCommit?(value: ValueT): void
  value: ValueT
}

class ActionTransaction {
  readonly afterCommit: Array<() => void> = []
  readonly detached: Array<() => PromiseLike<unknown>> = []
  readonly frames: string[] = []
  readonly resources = new Map<object, TransactionResource<any>>()
  externalEffects = false
  committed = false

  resource<ValueT>(
    key: object,
    create: () => ValueT,
    commit: (value: ValueT) => void,
    prepare?: (value: ValueT) => void,
    rollbackCommit?: (value: ValueT) => void,
  ): ValueT {
    const existing = this.resources.get(key) as TransactionResource<ValueT> | undefined
    if (existing) {
      return existing.value
    }
    const value = create()
    this.resources.set(key, { commit, prepare, rollbackCommit, value })
    return value
  }

  existing<ValueT>(key: object): ValueT | undefined {
    return (this.resources.get(key) as TransactionResource<ValueT> | undefined)?.value
  }

  commit(): void {
    for (const resource of this.resources.values()) {
      resource.prepare?.(resource.value)
    }
    const committed: TransactionResource<any>[] = []
    try {
      for (const resource of this.resources.values()) {
        committed.push(resource)
        resource.commit(resource.value)
      }
      this.committed = true
    } catch (error) {
      for (const resource of committed.reverse()) {
        resource.rollbackCommit?.(resource.value)
      }
      throw error
    }
  }

  rollback(): void {
    // Overlays are private until commit, so a body failure has no published resource to undo.
  }
}

/** TaoActionFailure is the deliberate, typed control-flow signal produced by `fail`. */
export class TaoActionFailure extends Error {
  override readonly name = 'TaoActionFailure'

  constructor(
    readonly caseName: string,
    readonly declaredSentence: string,
    readonly providerSentence?: string,
  ) {
    super(providerSentence || declaredSentence || 'The action failed.')
  }
}

let activeTransaction: ActionTransaction | undefined
let rootQueue: Promise<void> = Promise.resolve()
let queuedRoots = 0
let externalEffectRevision = 0
const failureListeners = new Set<(failure: TaoActionFailureReport) => void>()
const actionHistory: TaoActionFailureReport[] = []
const failureFrames = new WeakMap<object, readonly string[]>()

/** runAction serializes roots and lets nested `do` calls join the caller's active transaction. */
export function runAction(
  name: string,
  arguments_: readonly unknown[],
  body: () => unknown,
  join = false,
  interrupt = false,
): void | Promise<void> {
  if (join && activeTransaction) {
    return runJoinedAction(activeTransaction, name, body)
  }
  const suspendedTransaction = interrupt ? activeTransaction : undefined
  const run = (): void | Promise<void> => {
    const transaction = new ActionTransaction()
    let pending = false
    activeTransaction = transaction
    transaction.frames.push(name)
    try {
      const result = body()
      if (isPromiseLike(result)) {
        pending = true
        return Promise.resolve(result).then(
          () => {
            try {
              finishRootSuccess(transaction)
            } catch (error) {
              finishRootFailure(transaction, error, name, arguments_)
            }
          },
          error => finishRootFailure(transaction, error, name, arguments_),
        ).finally(() => finishRoot(transaction, suspendedTransaction))
      }
      finishRootSuccess(transaction)
    } catch (error) {
      finishRootFailure(transaction, error, name, arguments_)
    } finally {
      if (!pending) {
        finishRoot(transaction, suspendedTransaction)
      }
    }
  }
  // A response action is the one root allowed to cross a suspended ask. It executes in its own
  // transaction, then restores the asking transaction before that action's continuation resumes.
  const result = interrupt || queuedRoots === 0 ? run() : rootQueue.then(run, run)
  if (!isPromiseLike(result)) {
    return
  }
  if (interrupt) {
    return result
  }
  queuedRoots += 1
  rootQueue = Promise.resolve(result).then(
    () => {
      queuedRoots -= 1
    },
    () => {
      queuedRoots -= 1
    },
  )
  return result
}

function finishRootSuccess(transaction: ActionTransaction): void {
  activeTransaction = undefined
  transaction.commit()
}

function finishRootFailure(
  transaction: ActionTransaction,
  error: unknown,
  name: string,
  arguments_: readonly unknown[],
): void {
  activeTransaction = undefined
  transaction.rollback()
  publishFailure(actionFailureReport(error, transaction, name, arguments_), name === 'async' ? error : undefined)
}

function finishRoot(transaction: ActionTransaction, suspendedTransaction?: ActionTransaction): void {
  activeTransaction = suspendedTransaction
  transaction.frames.pop()
  if (transaction.committed) {
    for (const effect of transaction.afterCommit) {
      try {
        effect()
      } catch (error) {
        // The transaction is already durable. Surface each unowned publication failure without
        // rejecting the committed action or preventing remaining cleanup/effects.
        reportUnownedFailure(error)
      }
    }
  }
  for (const detached of transaction.detached) {
    void enqueueDetached(detached)
  }
}

function runJoinedAction(
  transaction: ActionTransaction,
  name: string,
  body: () => unknown,
): void | Promise<void> {
  transaction.frames.push(name)
  let pending = false
  try {
    const result = body()
    if (isPromiseLike(result)) {
      pending = true
      return Promise.resolve(result).then(
        () => undefined,
        error => {
          recordFailureFrames(error, transaction)
          throw error
        },
      ).finally(() => transaction.frames.pop())
    }
  } catch (error) {
    recordFailureFrames(error, transaction)
    throw error
  } finally {
    if (!pending) {
      transaction.frames.pop()
    }
  }
}

function recordFailureFrames(error: unknown, transaction: ActionTransaction): void {
  if (typeof error === 'object' && error !== null && !failureFrames.has(error)) {
    failureFrames.set(error, [...transaction.frames])
  }
}

async function enqueueDetached(body: () => PromiseLike<unknown>): Promise<void> {
  await runAction('async', [], body)
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function'
}

/** transactionResource gives state and data stores an isolated read-your-writes overlay. */
export function transactionResource<ValueT>(
  key: object,
  create: () => ValueT,
  commit: (value: ValueT) => void,
  prepare?: (value: ValueT) => void,
  rollbackCommit?: (value: ValueT) => void,
): ValueT | undefined {
  return activeTransaction?.resource(key, create, commit, prepare, rollbackCommit)
}

/** existingTransactionResource reads an overlay without creating one. */
export function existingTransactionResource<ValueT>(key: object): ValueT | undefined {
  return activeTransaction?.existing<ValueT>(key)
}

/** deferDetached starts an `async` body after its caller commits or rolls back. */
export function deferDetached(body: () => PromiseLike<unknown>): void {
  if (activeTransaction) {
    activeTransaction.detached.push(body)
    return
  }
  // Host-authored detached work outside a Tao action preserves the established immediate behavior.
  // A generated `async` statement is always encountered inside an action and takes the branch above.
  void (async () => await body())().catch(reportUnownedFailure)
}

/** deferTransactionCommit publishes an effect only after the current transaction commits and yields ownership. */
export function deferTransactionCommit(effect: () => void): void {
  if (activeTransaction) {
    activeTransaction.afterCommit.push(effect)
    return
  }
  effect()
}

/** markExternalEffect makes a transaction ineligible for automatic retry. */
export function markExternalEffect(): void {
  externalEffectRevision += 1
  if (activeTransaction) {
    activeTransaction.externalEffects = true
  }
}

/** currentExternalEffectRevision lets a render boundary reject retries after a foreign effect. */
export function currentExternalEffectRevision(): number {
  return externalEffectRevision
}

/** actionFailureCaseName extracts the stable source case name from a Tao enum value. */
export function actionFailureCaseName(value: { evaluate(): { jsValue: unknown } } | string): string {
  if (typeof value === 'string') {
    return value
  }
  const evaluated = value.evaluate().jsValue
  if (typeof evaluated === 'object' && evaluated !== null && 'identity' in evaluated) {
    const identity = (evaluated as { identity: unknown }).identity
    if (typeof identity === 'symbol') {
      return identity.description ?? 'Failure'
    }
  }
  return 'Failure'
}

/** onActionFailure observes contained root action failures. */
export function onActionFailure(listener: (failure: TaoActionFailureReport) => void): () => void {
  failureListeners.add(listener)
  return () => failureListeners.delete(listener)
}

/** captureActionHistory returns the bounded, structurally redacted diagnostic action log. */
export function captureActionHistory(): readonly TaoActionFailureReport[] {
  return actionHistory.map(entry => ({ ...entry, arguments: [...entry.arguments], frames: [...entry.frames] }))
}

/** resetActionDiagnostics clears retained diagnostic history without changing app state. */
export function resetActionDiagnostics(): void {
  actionHistory.length = 0
}

function restoreActionHistory(value: unknown): void {
  actionHistory.length = 0
  if (!Array.isArray(value)) {
    return
  }
  actionHistory.push(...value.slice(-50) as TaoActionFailureReport[])
}

function actionFailureReport(
  error: unknown,
  transaction: ActionTransaction,
  action: string,
  arguments_: readonly unknown[],
): TaoActionFailureReport {
  const failure = error instanceof TaoActionFailure
    ? error
    : new TaoActionFailure('Unexpected', '', error instanceof Error ? error.message : '')
  return Object.freeze({
    action,
    arguments: sanitize(arguments_) as readonly unknown[],
    case: failure.caseName,
    frames: typeof error === 'object' && error !== null
      ? [...(failureFrames.get(error) ?? transaction.frames)]
      : [...transaction.frames],
    message: failure.providerSentence
      || failure.declaredSentence
      || `Couldn't finish '${action}.' Nothing was changed.`,
    retryEligible: !transaction.externalEffects,
    timestamp: Date.now(),
  })
}

function publishFailure(failure: TaoActionFailureReport, unownedError?: unknown): void {
  actionHistory.push(failure)
  if (actionHistory.length > 50) {
    actionHistory.splice(0, actionHistory.length - 50)
  }
  for (const listener of failureListeners) {
    listener(failure)
  }
  if (failureListeners.size === 0) {
    reportUnownedFailure(unownedError ?? new TaoActionFailure(failure.case, failure.message))
  }
}

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (typeof value !== 'object') {
    return undefined
  }
  if (seen.has(value)) {
    return '[circular]'
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map(item => sanitize(item, seen))
  }
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/credential|password|secret|token|authorization/i.test(key)) {
      continue
    }
    result[key] = sanitize(entry, seen)
  }
  return result
}

registerRuntimeCaptureDomain({
  capture: () => captureActionHistory() as TaoRuntimeJson,
  domain: 'action-history',
  restore: restoreActionHistory,
  version: 1,
})
