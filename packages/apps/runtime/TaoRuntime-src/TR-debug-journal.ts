import type { TaoDebugPendingWrite } from './TR-action-transactions'
import { runtimeListeners } from './TR-listeners'

/**
 * TR-debug-journal.ts is the debugger's record of what ran and the one place its events are
 * published from. It is a leaf on purpose: the transaction runtime journals through it and the
 * debugger controller reads and emits through it, so neither has to import the other.
 */

/** TaoDebugStep carries both readable labels and canonical compiler-owned structural identity. */
export type TaoDebugStep = Readonly<{
  action: string
  declaration?: string
  path: string
  statement?: string
}>

export type TaoDebugJournalEntry = Readonly<{
  action: string
  outcome: 'running' | 'committed' | 'failed' | 'abandoned'
  failureCase?: string
  externalEffect: boolean
  frames: readonly string[]
  rootId: number
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
  | Readonly<{ kind: 'reset' }>

/** Mirrored by `journalLimit` in `packages/ides/studio/studio-src/client/matrix/StudioDebugEvents.ts`;
 * the runtime imports nothing, so the two are kept in step by hand. */
const journalLimit = 200

const listeners = runtimeListeners<[event: TaoDebugEvent]>()
const journal: TaoDebugJournalEntry[] = []
let nextRootId = 0

export function emitDebugEvent(event: TaoDebugEvent): void {
  listeners.notify(event)
}

export function onDebugEvent(listener: (event: TaoDebugEvent) => void): () => void {
  return listeners.subscribe(listener)
}

export function debugJournal(): readonly TaoDebugJournalEntry[] {
  return journal
}

export function clearDebugJournal(): void {
  journal.length = 0
}

/** journalStart records a root beginning; the transaction runtime calls it. */
export function journalStart(action: string, frames: readonly string[]): TaoDebugJournalEntry | undefined {
  // Release and ordinary development builds have no debugger bridge. Do not retain action roots or
  // their values unless tooling is actively listening for the journal.
  if (listeners.count() === 0) {
    return undefined
  }
  const entry: TaoDebugJournalEntry = {
    action,
    outcome: 'running',
    externalEffect: false,
    frames: [...frames],
    rootId: ++nextRootId,
    startedAt: Date.now(),
  }
  journal.push(entry)
  if (journal.length > journalLimit) {
    journal.shift()
  }
  emitDebugEvent({ kind: 'journal', entry })
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
  const index = journal.findIndex(candidate => candidate.rootId === entry.rootId)
  if (index >= 0) {
    journal[index] = settled
    emitDebugEvent({ kind: 'journal', entry: settled })
  }
}
