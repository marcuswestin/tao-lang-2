import type { TaoDebugPendingWrite } from './TR-action-transactions'

/**
 * TR-debug-journal.ts is the debugger's record of what ran and the one place its events are
 * published from. It is a leaf on purpose: the transaction runtime journals through it and the
 * debugger controller reads and emits through it, so neither has to import the other.
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

const journalLimit = 200

const listeners = new Set<(event: TaoDebugEvent) => void>()
const journal: TaoDebugJournalEntry[] = []

export function emitDebugEvent(event: TaoDebugEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

export function onDebugEvent(listener: (event: TaoDebugEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function debugJournal(): readonly TaoDebugJournalEntry[] {
  return journal
}

export function clearDebugJournal(): void {
  journal.length = 0
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
  const index = journal.indexOf(entry)
  if (index >= 0) {
    journal[index] = settled
  }
  emitDebugEvent({ kind: 'journal', entry: settled })
}
