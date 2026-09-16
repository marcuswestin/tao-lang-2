import {
  resumeSuspendedTransaction,
  suspendActiveTransaction,
  type SuspendedTransaction,
} from './TR-action-transactions'
import {
  clearDebugJournal,
  debugJournal,
  emitDebugEvent,
  onDebugEvent,
  type TaoDebugPause,
  type TaoDebugStep,
} from './TR-debug-journal'
import { Clock } from './TR-units'

/**
 * TR-debug.ts is the debugger controller: a breakpoint table, the step mode, and the statement gate
 * an instrumented action body awaits before each statement. The journal and the event listeners it
 * publishes through live in TR-debug-journal.ts, which the transaction runtime shares. This is
 * tooling over the runtime; nothing here is reachable from Tao source, and with no breakpoint set
 * the gate returns without awaiting, so an instrumented body runs as an uninstrumented one would.
 */

export type { TaoDebugEvent, TaoDebugJournalEntry, TaoDebugPause, TaoDebugStep } from './TR-debug-journal'

type StepMode = 'continue' | 'over' | 'into' | 'out'

const breakpoints = new Set<string>()
const entryBreakpoints = new Set<string>()
let stepMode: StepMode = 'continue'
let pauseDepth = 0
let paused: { resolve(mode: StepMode): void; pause: TaoDebugPause; depth: number } | undefined

function stepKey(step: TaoDebugStep): string {
  return `${step.action}#${step.path}`
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

  /**
   * Break stops the next statement gate that runs, whichever action reaches one first. It is the
   * pause button: a person presses it, then does the thing in the app they want to watch.
   */
  Break(): void {
    stepMode = 'into'
  },

  Continue(): void {
    // With nothing paused, Continue cancels a Break nobody reached yet.
    stepMode = 'continue'
    resume('continue')
  },

  Step(mode: Exclude<StepMode, 'continue'>): void {
    resume(mode)
  },

  /** Paused reports the current pause, if any. */
  Paused(): TaoDebugPause | undefined {
    return paused?.pause
  },

  Journal: debugJournal,

  onEvent: onDebugEvent,

  /** Reset clears journal, breakpoints, and any pause; tests call it between checks. */
  Reset(): void {
    clearDebugJournal()
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
    emitDebugEvent({ kind: 'paused', pause })
  })
  releaseClock()
  stepMode = mode
  resumeSuspendedTransaction(suspended)
  emitDebugEvent({ kind: 'resumed' })
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
