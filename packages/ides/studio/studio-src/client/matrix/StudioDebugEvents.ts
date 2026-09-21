import type { StudioJsonValue } from '../../StudioProtocol'

/**
 * StudioDebugEvents folds the debugger events a preview posts into the state the Debug drawer
 * renders: a journal of action roots and, while a root is stopped at a statement gate, the pause.
 * The preview is a separate document, so every event arrives as loose JSON; nothing here trusts a
 * shape it has not checked, and an event it cannot read leaves the state alone.
 */

export type StudioDebugJournalRow = Readonly<{
  action: string
  failureCase?: string
  frames: readonly string[]
  outcome: string
  rootId: number
  startedAt: number
}>

type StudioDebugBinding = Readonly<{ name: string; value: string }>

type StudioDebugPendingWrite = Readonly<{
  committed: string
  kind: string
  pending: string
  target: string
}>

export type StudioDebugPauseSnapshot = Readonly<{
  action: string
  frames: readonly string[]
  path: string
  pendingWrites: readonly StudioDebugPendingWrite[]
  scope: readonly StudioDebugBinding[]
}>

export type StudioDebugState = Readonly<{
  journal: readonly StudioDebugJournalRow[]
  pause?: StudioDebugPauseSnapshot
}>

/** A journal longer than this is history nobody scrolls to; the runtime bounds its own at 200. */
const journalLimit = 200

export const StudioDebugEvents = {
  empty(): StudioDebugState {
    return { journal: [] }
  },

  /** receive folds one event into the drawer state, returning the state unchanged if it is unreadable. */
  receive(state: StudioDebugState, event: StudioJsonValue): StudioDebugState {
    if (!isObject(event)) {
      return state
    }
    if (event['kind'] === 'resumed') {
      return { journal: state.journal }
    }
    if (event['kind'] === 'reset') {
      return { journal: [] }
    }
    if (event['kind'] === 'paused') {
      const pause = pauseSnapshot(event['pause'])
      return pause === undefined ? state : { journal: state.journal, pause }
    }
    if (event['kind'] !== 'journal') {
      return state
    }
    const entry = journalRow(event['entry'])
    return entry === undefined ? state : { ...state, journal: mergeJournal(state.journal, entry) }
  },
} as const

/**
 * A root is journaled twice: once as it starts and once as it settles. Its monotonic runtime identity
 * makes the pair unambiguous even when repeated same-name roots start in one clock tick.
 */
function mergeJournal(
  journal: readonly StudioDebugJournalRow[],
  entry: StudioDebugJournalRow,
): readonly StudioDebugJournalRow[] {
  const index = journal.findIndex(row => row.rootId === entry.rootId)
  const merged = index < 0
    ? [...journal, entry]
    : [...journal.slice(0, index), entry, ...journal.slice(index + 1)]
  return merged.slice(-journalLimit)
}

function journalRow(value: unknown): StudioDebugJournalRow | undefined {
  if (
    !isObject(value)
    || typeof value['action'] !== 'string'
    || typeof value['outcome'] !== 'string'
    || typeof value['rootId'] !== 'number'
    || typeof value['startedAt'] !== 'number'
  ) {
    return undefined
  }
  const failureCase = value['failureCase']
  return {
    action: value['action'],
    ...(typeof failureCase === 'string' ? { failureCase } : {}),
    frames: textList(value['frames']),
    outcome: value['outcome'],
    rootId: value['rootId'],
    startedAt: value['startedAt'],
  }
}

function pauseSnapshot(value: unknown): StudioDebugPauseSnapshot | undefined {
  if (!isObject(value) || !isObject(value['step'])) {
    return undefined
  }
  const step = value['step']
  if (typeof step['action'] !== 'string' || typeof step['path'] !== 'string') {
    return undefined
  }
  const scope = value['scope']
  return {
    action: step['action'],
    frames: textList(value['frames']),
    path: step['path'],
    pendingWrites: pendingWrites(value['pendingWrites']),
    scope: isObject(scope)
      ? Object.keys(scope).sort().map(name => ({ name, value: display(scope[name]) }))
      : [],
  }
}

function pendingWrites(value: unknown): readonly StudioDebugPendingWrite[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isObject).map(write => ({
    committed: display(write['committed']),
    kind: typeof write['kind'] === 'string' ? write['kind'] : 'unknown',
    pending: display(write['pending']),
    target: typeof write['target'] === 'string' ? write['target'] : '',
  }))
}

function textList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * A binding or a write reaches the drawer as display text. The event is already JSON, so a key that
 * is absent is a value the preview had none of: a create has no committed side, a delete no pending.
 */
function display(value: unknown): string {
  if (value === undefined) {
    return '—'
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
