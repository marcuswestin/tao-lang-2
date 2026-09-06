import {
  resumeSuspendedTransaction,
  suspendActiveTransaction,
  type SuspendedTransaction,
  type TaoDebugPendingWrite,
} from './TR-action-transactions'
import { Clock } from './TR-units'

/**
 * TR-debug.ts is the debugger controller: a journal of every action root, a breakpoint table, and
 * the statement gate an instrumented action body awaits before each statement. It is tooling over
 * the runtime; nothing here is reachable from Tao source, and with no breakpoint set the gate
 * returns a resolved promise so an instrumented body runs as an uninstrumented one would.
 */

/** TaoDebugStep is the stable identity of one action statement: owning action and statement path. */
export type TaoDebugStep = Readonly<{ action: string; path: string }>

export type TaoDebugJournalEntry = Readonly<{
  action: string
  arguments: readonly unknown[]
  outcome: 'running' | 'committed' | 'failed' | 'abandoned'
  failureCase?: string
  externalEffect: boolean
  frames: readonly string[]
  startedAt: number
  settledAt?: number
}>

export type TaoDebugPause = Readonly<{
  step: TaoDebugStep
  frames: readonly string[]
  scope: Readonly<Record<string, unknown>>
  pendingWrites: readonly TaoDebugPendingWrite[]
}>

export type TaoDebugEvent =
  | Readonly<{ kind: 'journal'; entry: TaoDebugJournalEntry }>
  | Readonly<{ kind: 'paused'; pause: TaoDebugPause }>
  | Readonly<{ kind: 'resumed' }>

type StepMode = 'continue' | 'over' | 'into' | 'out'

const JOURNAL_LIMIT = 200

const listeners = new Set<(event: TaoDebugEvent) => void>()
const journal: TaoDebugJournalEntry[] = []
const breakpoints = new Set<string>()
const entryBreakpoints = new Set<string>()
let stepMode: StepMode = 'continue'
let pauseDepth = 0
let paused: { resolve(mode: StepMode): void; pause: TaoDebugPause; depth: number } | undefined

function stepKey(step: TaoDebugStep): string {
  return `${step.action}#${step.path}`
}

function emit(event: TaoDebugEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

/** shouldPause decides whether the gate stops at this statement. */
function shouldPause(step: TaoDebugStep, depth: number): boolean {
  if (breakpoints.has(stepKey(step))) {
    return true
  }
  // An action-entry breakpoint is the gate before the action's first statement.
  if (step.path === '0' && entryBreakpoints.has(step.action)) {
    return true
  }
  return stepModeStops[stepMode](depth)
}

/** stepModeStops says, per step mode, whether a gate at this frame depth stops. */
const stepModeStops: Record<StepMode, (depth: number) => boolean> = {
  continue: () => false,
  into: () => true,
  over: depth => depth <= pauseDepth,
  out: depth => depth < pauseDepth,
}

function scopeSnapshot(scope: object): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const key of Object.keys(scope)) {
    const value = (scope as Record<string, unknown>)[key]
    const evaluable = value as { evaluate?: () => { jsValue: unknown } } | undefined
    snapshot[key] = typeof evaluable?.evaluate === 'function' ? evaluable.evaluate().jsValue : value
  }
  return snapshot
}

export const Debug = {
  /**
   * At is the statement gate. An instrumented body awaits it before every statement. While paused
   * the root gives up the active transaction, so a render that happens meanwhile reads committed
   * values rather than the overlay the paused body is still building.
   */
  At(step: TaoDebugStep, scope: object): Promise<void> | void {
    const suspended = suspendActiveTransaction()
    const depth = suspended?.frames.length ?? 0
    if (!suspended || !shouldPause(step, depth)) {
      resumeSuspendedTransaction(suspended)
      return
    }
    return pauseAt(step, scope, suspended)
  },

  /** Configure replaces the breakpoint table. */
  Configure(config: { steps?: readonly TaoDebugStep[]; actions?: readonly string[] }): void {
    breakpoints.clear()
    entryBreakpoints.clear()
    for (const step of config.steps ?? []) {
      breakpoints.add(stepKey(step))
    }
    for (const action of config.actions ?? []) {
      entryBreakpoints.add(action)
    }
  },

  Continue(): void {
    resume('continue')
  },

  Step(mode: Exclude<StepMode, 'continue'>): void {
    resume(mode)
  },

  /** Paused reports the current pause, if any. */
  Paused(): TaoDebugPause | undefined {
    return paused?.pause
  },

  Journal(): readonly TaoDebugJournalEntry[] {
    return journal
  },

  onEvent(listener: (event: TaoDebugEvent) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Reset clears journal, breakpoints, and any pause; tests call it between checks. */
  Reset(): void {
    journal.length = 0
    breakpoints.clear()
    entryBreakpoints.clear()
    stepMode = 'continue'
    paused?.resolve('continue')
    paused = undefined
  },
} as const

async function pauseAt(step: TaoDebugStep, scope: object, suspended: SuspendedTransaction): Promise<void> {
  const pause: TaoDebugPause = {
    step,
    frames: [...suspended.frames],
    scope: scopeSnapshot(scope),
    pendingWrites: suspended.pendingWrites(),
  }
  // Time stands still while a person reads the pause, as it does for a test check, so no ticker
  // or toast expiry queues a root behind the paused one.
  const releaseClock = Clock.hold()
  const mode = await new Promise<StepMode>(resolve => {
    paused = { resolve, pause, depth: suspended.frames.length }
    emit({ kind: 'paused', pause })
  })
  releaseClock()
  stepMode = mode
  resumeSuspendedTransaction(suspended)
  emit({ kind: 'resumed' })
}

function resume(mode: StepMode): void {
  const current = paused
  if (!current) {
    return
  }
  pauseDepth = current.depth
  paused = undefined
  current.resolve(mode)
}

/** journalStart records a root beginning; the transaction runtime calls it. */
export function journalStart(action: string, arguments_: readonly unknown[]): TaoDebugJournalEntry {
  const entry: TaoDebugJournalEntry = {
    action,
    arguments: arguments_,
    outcome: 'running',
    externalEffect: false,
    frames: [],
    startedAt: Date.now(),
  }
  journal.push(entry)
  if (journal.length > JOURNAL_LIMIT) {
    journal.shift()
  }
  emit({ kind: 'journal', entry })
  return entry
}

/** journalSettle records how a root ended. */
export function journalSettle(
  entry: TaoDebugJournalEntry,
  outcome: Exclude<TaoDebugJournalEntry['outcome'], 'running'>,
  details: { externalEffect: boolean; frames: readonly string[]; failureCase?: string },
): void {
  const settled: TaoDebugJournalEntry = {
    ...entry,
    outcome,
    externalEffect: details.externalEffect,
    frames: details.frames,
    failureCase: details.failureCase,
    settledAt: Date.now(),
  }
  const index = journal.indexOf(entry)
  if (index >= 0) {
    journal[index] = settled
  }
  emit({ kind: 'journal', entry: settled })
}
