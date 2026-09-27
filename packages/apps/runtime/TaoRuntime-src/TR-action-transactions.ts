import { Arrays } from './core/RuntimeCore'
import { type TestActionStubContext, TestActionStubs } from './TR-action-test-stubs'
import { RuntimeAssert } from './TR-assert'
import { journalSettle, journalStart, type TaoDebugJournalEntry } from './TR-debug-journal'
import {
  recordActionFailureFrames,
  reportActionFailure,
  reportUnownedFailure,
  TaoActionFailure,
  type TaoActionFailureReport,
} from './TR-errors'
import type { TaoActionOwner } from './TR-native-subscription'

/** A receipt belongs to one root, including roots whose contained failure never rejects. */
export type TaoActionReceipt = Readonly<{
  outcome: 'committed' | 'failed' | 'abandoned'
  failure?: TaoActionFailureReport
}>
const actionReceipts = new Map<(receipt: TaoActionReceipt) => void, number>()

export type TaoDeclaredFailure = Readonly<{
  case: { evaluate(): { jsValue: unknown } }
  sentence: string
}>

type TransactionResource<ValueT> = {
  commit(value: ValueT): void
  prepare?(value: ValueT): void
  rollbackCommit?(value: ValueT): void
  describe?(value: ValueT): readonly TaoDebugPendingWrite[]
  savepoint?(value: ValueT): () => void
  /** reset puts an overlay with its own savepoint back to how it was created. */
  reset?: () => void
  value: ValueT
}

/**
 * TaoResourceSavepoint captures one overlay so a contained `when do` failure can put it back. It
 * returns the restore. An overlay that changes nothing in place below its own fields needs none: the
 * default copies those fields and restores them, and a default overlay first touched after the
 * savepoint is dropped. An overlay that supplies its own savepoint is instead reset to how it was
 * created, because it may carry something a restore must keep, such as a monotonic id counter.
 */
type TaoResourceSavepoint<ValueT> = (value: ValueT) => () => void

/** TaoDebugPendingWrite is one write a transaction will publish at commit, beside its committed value. */
export type TaoDebugPendingWrite = Readonly<{
  kind: 'state' | 'persisted' | 'data'
  target: string
  committed: unknown
  pending: unknown
}>

/**
 * launchGeneration numbers the launch every action root belongs to. It is declared above the
 * transaction because each transaction stamps itself with the launch it started in.
 */
let launchGeneration = 0

class ActionTransaction {
  readonly afterCommit: Array<() => void> = []
  readonly rollbackEffects: Array<() => void> = []
  readonly detached: Array<
    { body: () => PromiseLike<unknown>; testStubs: TestActionStubContext; owner?: TaoActionOwner }
  > = []
  readonly frames: string[] = []
  readonly frameTrail: string[] = []
  readonly resources = new Map<object, TransactionResource<any>>()
  externalEffects = false
  committed = false
  journal: TaoDebugJournalEntry | undefined
  failure: unknown
  failureReport: TaoActionFailureReport | undefined
  settled = false

  constructor(
    readonly launch: number,
    readonly testStubs: TestActionStubContext,
    readonly receipt?: (receipt: TaoActionReceipt) => void,
    readonly owner?: TaoActionOwner,
  ) {}

  pushFrame(name: string): void {
    this.frames.push(name)
    if (this.frames.length >= this.frameTrail.length) {
      this.frameTrail.splice(0, this.frameTrail.length, ...this.frames)
    }
  }

  popFrame(): void {
    this.frames.pop()
  }

  resource<ValueT>(
    key: object,
    create: () => ValueT,
    commit: (value: ValueT) => void,
    prepare?: (value: ValueT) => void,
    rollbackCommit?: (value: ValueT) => void,
    describe?: (value: ValueT) => readonly TaoDebugPendingWrite[],
    savepoint?: TaoResourceSavepoint<ValueT>,
  ): ValueT {
    const existing = this.resources.get(key) as TransactionResource<ValueT> | undefined
    if (existing) {
      return existing.value
    }
    const value = create()
    const reset = savepoint?.(value)
    this.resources.set(key, { commit, describe, prepare, reset, rollbackCommit, savepoint, value })
    return value
  }

  /**
   * savepoint captures every overlay and the commit effects and detached `async` work queued so far,
   * and returns the restore. Restoring drops or resets an overlay the savepoint did not see, so a
   * resource first touched after it reads its committed value again, and drops the commit effects and
   * detached work queued after it. External effects that already ran stay recorded: they happened, and a retry must
   * still know it.
   */
  savepoint(): () => void {
    const restores = [...this.resources.values()].map(resource =>
      (resource.savepoint ?? shallowSavepoint)(resource.value)
    )
    const keys = new Set(this.resources.keys())
    const afterCommit = this.afterCommit.length
    const detached = this.detached.length
    const rollbackEffects = this.rollbackEffects.length
    return () => {
      for (const [key, resource] of [...this.resources]) {
        if (keys.has(key)) {
          continue
        }
        if (resource.reset) {
          resource.reset()
        } else {
          this.resources.delete(key)
        }
      }
      for (const restore of restores) {
        restore()
      }
      this.afterCommit.length = afterCommit
      this.detached.length = detached
      this.cleanEffects(this.rollbackEffects.splice(rollbackEffects))
    }
  }

  /** pendingWrites describes every write this transaction would publish at commit. */
  pendingWrites(): readonly TaoDebugPendingWrite[] {
    const writes: TaoDebugPendingWrite[] = []
    for (const resource of this.resources.values()) {
      writes.push(...(resource.describe?.(resource.value) ?? []))
    }
    return writes
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
      for (const resource of Arrays.reversed(committed)) {
        resource.rollbackCommit?.(resource.value)
      }
      throw error
    }
  }

  private cleanEffects(effects: Array<() => void>): void {
    for (const cleanup of effects) {
      try {
        cleanup()
      } catch (error) {
        reportUnownedFailure(error)
      }
    }
  }

  rollback(): void {
    this.cleanEffects(this.rollbackEffects.splice(0))
  }
}

function shallowSavepoint<ValueT>(value: ValueT): () => void {
  const fields = { ...value }
  return () => {
    Object.assign(value as object, fields)
  }
}

let activeTransaction: ActionTransaction | undefined
let rootQueue: Promise<void> = Promise.resolve()
let queuedRoots = 0
let externalEffectRevision = 0

/** Let an external invocation read committed state after already admitted roots settle. */
export async function settleActionRoots(): Promise<void> {
  let pending: Promise<void>
  do {
    pending = rootQueue
    await pending
  } while (pending !== rootQueue)
}

/** TaoActionContinuation is the compiler-carried transaction identity for one async action root. */
export type TaoActionContinuation = Readonly<{ transaction?: object }>

/** captureActionContinuation binds generated continuation segments to their invoking transaction. */
export function captureActionContinuation(): TaoActionContinuation {
  return { ...(activeTransaction ? { transaction: activeTransaction } : {}) }
}

/** resumeActionContinuation selects the transaction owned by the generated segment about to run. */
export function resumeActionContinuation(continuation: TaoActionContinuation): void {
  const transaction = continuation.transaction as ActionTransaction | undefined
  if (transaction && !transaction.settled) {
    activeTransaction = transaction
  }
}

/** The active action keeps the check whose foreign outcomes it may observe. */
export function actionTestStubContext(): TestActionStubContext {
  return activeTransaction?.testStubs ?? TestActionStubs.capture()
}

/**
 * beginActionLaunch ends the launch every running action root belongs to. A root the ending launch
 * started can still be suspended — on an `ask`, or on any other await — and the instance it was
 * running against is gone, so it must not publish into the instance that replaces it. Such a root
 * abandons its transaction instead of committing it, and reports nothing: an app that no longer
 * exists has not failed, so a diagnostic here would name a problem nobody can act on.
 *
 * The serialization queue goes with the launch too. It ordered that launch's roots, and a root the
 * boundary parks forever would otherwise hold every root of the next launch behind it.
 *
 * The active transaction is deliberately left standing. A suspended root still owns it, and a body
 * that resumes after this boundary has to keep writing into the overlay that is about to be dropped;
 * clearing the pointer would send those writes straight to the published store instead.
 */
export function beginActionLaunch(): void {
  launchGeneration += 1
  for (const [receipt, launch] of actionReceipts) {
    if (launch !== launchGeneration) {
      receipt({ outcome: 'abandoned' })
    }
  }
  rootQueue = Promise.resolve()
  queuedRoots = 0
}

/**
 * suspendAcrossLaunch parks an action continuation whose launch ended rather than resuming it. It
 * is the `ask` half of the boundary: the navigation reset a launch performs settles every pending
 * response, and a body resumed by that would go on presenting, dismissing, and asking against the
 * instance that replaced its own. Parking is what the process this action was running in does.
 */
export function suspendAcrossLaunch<ValueT>(pending: Promise<ValueT>): Promise<ValueT> {
  const launch = launchGeneration
  return pending.then(value => launch === launchGeneration ? value : new Promise<ValueT>(() => {}))
}

/** abandonedByLaunch reports that a root outlived the launch that started it. */
function abandonedByLaunch(transaction: ActionTransaction): boolean {
  return transaction.launch !== launchGeneration
}

/** runAction serializes roots and lets nested `do` calls join the caller's active transaction. */
export function runAction(
  name: string,
  arguments_: readonly unknown[],
  body: () => unknown,
  join = false,
  interrupt = false,
  testStubs = TestActionStubs.capture(),
  onReceipt?: (receipt: TaoActionReceipt) => void,
  owner?: TaoActionOwner,
): void | Promise<void> {
  if (join && activeTransaction) {
    return runJoinedAction(activeTransaction, name, body)
  }
  const suspendedTransaction = interrupt ? activeTransaction : undefined
  const launch = launchGeneration
  const receipt = onReceipt === undefined ? undefined : (value: TaoActionReceipt) => {
    if (actionReceipts.delete(receipt!)) {
      onReceipt(value)
    }
  }
  if (receipt) {
    actionReceipts.set(receipt, launch)
  }
  const run = (): void | Promise<void> => {
    const transaction = new ActionTransaction(launch, testStubs, receipt, owner)
    let pending = false
    activeTransaction = transaction
    transaction.pushFrame(name)
    transaction.journal = journalStart(name, transaction.frameTrail)
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
  // A launch that ends mid-root zeroes the count, so only a root of the current launch releases a
  // slot; without the guard a root of the ended launch would settle later and drive it negative.
  const release = (launch: number) => () => {
    if (launch === launchGeneration) {
      queuedRoots -= 1
    }
  }
  rootQueue = Promise.resolve(result).then(release(launchGeneration), release(launchGeneration))
  return result
}

function finishRootSuccess(transaction: ActionTransaction): void {
  if (activeTransaction === transaction) {
    activeTransaction = undefined
  }
  if (abandonedByLaunch(transaction)) {
    // Every resource this root touched is still private to the transaction, so dropping it without
    // committing is the rollback. Publishing here would write the ended launch's work into the one
    // that replaced it — a persisted value, a row, a state — after the person quit the app.
    transaction.rollback()
    return
  }
  transaction.commit()
}

function finishRootFailure(
  transaction: ActionTransaction,
  error: unknown,
  name: string,
  arguments_: readonly unknown[],
): void {
  if (activeTransaction === transaction) {
    activeTransaction = undefined
  }
  transaction.rollback()
  transaction.failure = error
  if (abandonedByLaunch(transaction)) {
    return
  }
  transaction.failureReport = reportActionFailure(
    error,
    transaction,
    name,
    arguments_,
    name === 'async' ? error : undefined,
    transaction.receipt !== undefined,
  )
}

function finishRoot(transaction: ActionTransaction, suspendedTransaction?: ActionTransaction): void {
  transaction.settled = true
  if (activeTransaction === undefined && suspendedTransaction && !suspendedTransaction.settled) {
    activeTransaction = suspendedTransaction
  }
  transaction.popFrame()
  settleJournal(transaction)
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
  if (abandonedByLaunch(transaction)) {
    transaction.receipt?.({ outcome: 'abandoned' })
    // An `async` body the ended launch queued belongs to that launch as much as its caller does.
    return
  }
  for (const detached of transaction.detached) {
    void enqueueDetached(detached.body, detached.testStubs, detached.owner)
  }
  transaction.receipt?.({
    outcome: transaction.committed ? 'committed' : 'failed',
    ...(transaction.failureReport ? { failure: transaction.failureReport } : {}),
  })
}

function settleJournal(transaction: ActionTransaction): void {
  if (!transaction.journal) {
    return
  }
  const outcome = abandonedByLaunch(transaction) ? 'abandoned' : transaction.committed ? 'committed' : 'failed'
  const failure = transaction.failure
  journalSettle(transaction.journal, outcome, {
    externalEffect: transaction.externalEffects,
    frames: transaction.frameTrail,
    failureCase: failure instanceof TaoActionFailure ? failure.caseName : undefined,
  })
}

/** SuspendedTransaction is what a paused root hands back to the debugger to restore on resume. */
export type SuspendedTransaction = Readonly<{
  frames: readonly string[]
  pendingWrites(): readonly TaoDebugPendingWrite[]
  transaction: object
}>

/**
 * suspendActiveTransaction releases the active transaction while a root is paused at a debugger
 * gate, so a render meanwhile reads committed values. The paused body resumes it before its next
 * statement writes. A gate reached outside any transaction returns undefined and restores nothing.
 */
export function suspendActiveTransaction(): SuspendedTransaction | undefined {
  const transaction = activeTransaction
  if (!transaction) {
    return undefined
  }
  activeTransaction = undefined
  return { frames: transaction.frames, pendingWrites: () => transaction.pendingWrites(), transaction }
}

/** resumeSuspendedTransaction puts a paused root's transaction back as the active one. */
export function resumeSuspendedTransaction(suspended: SuspendedTransaction | undefined): void {
  if (suspended) {
    activeTransaction = suspended.transaction as ActionTransaction
  }
}

function runJoinedAction(
  transaction: ActionTransaction,
  name: string,
  body: () => unknown,
): void | Promise<void> {
  transaction.pushFrame(name)
  let pending = false
  try {
    const result = body()
    if (isPromiseLike(result)) {
      pending = true
      return Promise.resolve(result).then(
        () => undefined,
        error => {
          recordActionFailureFrames(error, transaction.frames)
          throw error
        },
      ).finally(() => transaction.popFrame())
    }
  } catch (error) {
    recordActionFailureFrames(error, transaction.frames)
    throw error
  } finally {
    if (!pending) {
      transaction.popFrame()
    }
  }
}

async function enqueueDetached(
  body: () => PromiseLike<unknown>,
  testStubs: TestActionStubContext,
  owner?: TaoActionOwner,
): Promise<void> {
  await runAction('async', [], body, false, false, testStubs, undefined, owner)
}

/**
 * skippedActionRun is what a `runs latest` call settles with when a newer call replaced it before it
 * started. It never ran, so it neither finished nor failed.
 */
export const skippedActionRun: unique symbol = Symbol('tao.skippedActionRun')

/** isPromiseLike tells a suspended action body from one that finished synchronously. */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
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
  describe?: (value: ValueT) => readonly TaoDebugPendingWrite[],
  savepoint?: TaoResourceSavepoint<ValueT>,
): ValueT | undefined {
  return activeTransaction?.resource(key, create, commit, prepare, rollbackCommit, describe, savepoint)
}

/**
 * takeActionSavepoint marks the active transaction's private overlays before a contained `when do`
 * invocation and returns what puts them back. Outside a transaction there is nothing to restore.
 */
export function takeActionSavepoint(): () => void {
  return activeTransaction?.savepoint() ?? (() => {})
}

/**
 * existingTransactionResource reads an overlay without creating one. An overlay left behind by a
 * root the launch boundary abandoned is a write sink and nothing more: a write still lands in it so
 * that it is discarded rather than published, but no read comes back through it. The instance that
 * replaced the ended launch has to see what the device holds, not the value an action of the app the
 * person quit was still holding.
 */
export function existingTransactionResource<ValueT>(key: object): ValueT | undefined {
  if (!activeTransaction || abandonedByLaunch(activeTransaction)) {
    return undefined
  }
  return activeTransaction.existing<ValueT>(key)
}

/** deferDetached starts an `async` body after its caller commits or rolls back. */
export function deferDetached(body: () => PromiseLike<unknown>): void {
  if (activeTransaction) {
    activeTransaction.detached.push({ body, testStubs: activeTransaction.testStubs, owner: activeTransaction.owner })
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

/** Joined result calls retain the same transaction and failure frames as ordinary do. */
export async function runActionResult(
  name: string,
  arguments_: readonly unknown[],
  body: () => unknown,
  owner?: TaoActionOwner,
): Promise<unknown> {
  const joined = activeTransaction
  let result: unknown
  let completed = false
  let failed = false
  let failure: unknown
  let receipt: TaoActionReceipt | undefined
  await runAction(
    name,
    arguments_,
    async () => {
      try {
        result = await body()
        completed = true
      } catch (error) {
        failed = true
        failure = error
        throw error
      }
    },
    true,
    false,
    undefined,
    outcome => {
      receipt = outcome
    },
    owner,
  )
  if (failed) {
    throw failure
  }
  RuntimeAssert.input(
    completed && (joined ? !abandonedByLaunch(joined) : receipt?.outcome === 'committed'),
    'The action ended before its result could be used.',
  )
  return result
}

/** Registration reads ownership from the calling transaction rather than a render-global slot. */
export function actionOwner(): TaoActionOwner | undefined {
  return activeTransaction?.owner
}

/** Native resources acquired by a failing transaction are removed even while the view stays mounted. */
export function registerActionCleanup(cleanup: () => void): void {
  activeTransaction?.rollbackEffects.push(cleanup)
}
