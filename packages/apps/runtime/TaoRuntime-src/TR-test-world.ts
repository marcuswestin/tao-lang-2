import type { TaoDataConnection, TaoDataWriteIntent } from './TR-data'
import type { TaoSyncWriteRecovery } from './TR-data-sync'
import { UserInputError } from './TR-errors'

type Failure = { entity: string; message: string; operation: 'create' | 'delete' | 'update' }
type Pending = { entity: string; id: string; message?: string; operation: Failure['operation']; sequence: number }
type TestState = { pending: Pending[]; stored?: string }
type TestConnection = TaoDataConnection & { failure?: string; notify(): void; pending: Pending[] }

let online = true
const failures: Failure[] = []
let sequence = 0
const connections = new Set<TestConnection>()
const states = new Map<string, TestState>()

/** TestWorld is the per-journey provider stand-in, isolated from installed provider transport. */
export const TestWorld = {
  begin(): void {
    online = true
    failures.length = 0
    sequence = 0
    connections.clear()
    states.clear()
  },
  end(): void {
    connections.clear()
    failures.length = 0
    states.clear()
    online = true
  },
  network(mode: 'offline' | 'online'): void {
    online = mode === 'online'
    if (online) {
      for (const connection of connections) {
        for (
          const submission of new Set(
            connection.pending.filter(write => write.message === undefined)
              .map(write => write.sequence),
          )
        ) {
          settleSubmission(connection, submission)
        }
      }
    }
  },
  failAfter(operation: Failure['operation'], entity: string, message: string): void {
    failures.push({ entity, message, operation })
  },
  /** A failed save is guarded as error only for the isolated snapshot test stand-in. */
  isSnapshotConnection(connection: TaoDataConnection): boolean {
    return connections.has(connection as TestConnection) && connection.writes === undefined
  },
  async waitForSync(): Promise<void> {
    const pending = [...connections].flatMap(connection => connection.pending)
    const snapshotFailure = [...connections].find(connection => connection.failure !== undefined)?.failure
    if (snapshotFailure !== undefined) {
      throw new UserInputError(`Sync failed: ${snapshotFailure}`)
    }
    if (pending.length === 0) {
      return
    }
    if (!online) {
      throw new UserInputError('Cannot wait for sync while the network is offline.')
    }
    const failed = pending.find(write => write.message !== undefined)
    if (failed !== undefined) {
      throw new UserInputError(`Sync failed: ${failed.message}`)
    }
    for (const connection of connections) {
      connection.pending.length = 0
    }
  },
  connection(
    granular = false,
    storageKey?: string,
    initialSnapshot?: string,
    networkDependent = granular,
  ): TaoDataConnection {
    const state = storageKey === undefined
      ? { pending: [] as Pending[], stored: undefined as string | undefined }
      : states.get(storageKey) ?? { pending: [] as Pending[], stored: initialSnapshot }
    if (storageKey !== undefined) {
      states.set(storageKey, state)
    }
    const pending = state.pending
    const listeners = new Set<() => void>()
    const notify = () => {
      for (const listener of listeners) {
        listener()
      }
    }
    const writes: TaoSyncWriteRecovery = {
      retry(entity, id) {
        if (!online) {
          return
        }
        const submission = pending.find(write => write.entity === entity && write.id === id)?.sequence
        if (submission !== undefined) {
          settleSubmission(connection, submission)
        }
      },
      status(entity, id) {
        const matching = pending.filter(write => write.entity === entity && write.id === id)
        return {
          failed: matching.filter(write => write.message !== undefined).length,
          queued: matching.filter(write => write.message === undefined).length,
          records: matching.map(write => ({
            id: String(write.sequence),
            ...(write.message ? { message: write.message } : {}),
          })),
        }
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
    const connection: TestConnection = {
      close: () => {
        connections.delete(connection)
      },
      load: () => state.stored,
      notify,
      pending,
      referenceToken: reference => reference.id,
      resolveReference: reference => reference.token,
      save(snapshot, intents) {
        const changed = changedRows(state.stored, snapshot, intents)
        if (!granular) {
          if (!online && networkDependent) {
            connection.failure = 'Network is offline.'
            throw new UserInputError(connection.failure)
          }
          const message = takeFailure(changed)
          if (message !== undefined) {
            connection.failure = message
            throw new UserInputError(message)
          }
          state.stored = snapshot
          connection.failure = undefined
          return
        }
        state.stored = snapshot
        const delayed = !online && networkDependent
        const message = delayed ? undefined : takeFailure(changed)
        if (delayed || message !== undefined) {
          const submission = ++sequence
          for (const write of changed) {
            pending.push({ ...write, sequence: submission, ...(message !== undefined ? { message } : {}) })
          }
          notify()
        }
      },
      ...(granular ? { writes } : {}),
    }
    connections.add(connection)
    return connection
  },
} as const

function takeFailure(changed: readonly Pick<Pending, 'entity' | 'operation'>[]): string | undefined {
  const index = failures.findIndex(rule =>
    changed.some(write => write.entity === rule.entity && write.operation === rule.operation)
  )
  return index < 0 ? undefined : failures.splice(index, 1)[0]!.message
}

function settleSubmission(connection: TestConnection, submission: number): void {
  const writes = connection.pending.filter(write => write.sequence === submission)
  const message = takeFailure(writes)
  if (message === undefined) {
    connection.pending.splice(
      0,
      connection.pending.length,
      ...connection.pending.filter(write => write.sequence !== submission),
    )
  } else {
    for (const write of writes) {
      write.message = message
    }
  }
  connection.notify()
}

function changedRows(
  before: string | undefined,
  after: string,
  intents?: readonly TaoDataWriteIntent[],
): Array<{ entity: string; id: string; operation: Failure['operation'] }> {
  const rows = (value: string | undefined): Record<string, Array<{ Id: string }>> =>
    value === undefined ? {} : (JSON.parse(value) as { rows: Record<string, Array<{ Id: string }>> }).rows
  const previous = rows(before)
  const next = rows(after)
  const changed: Array<{ entity: string; id: string; operation: Failure['operation'] }> = []
  for (const entity of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const oldRows = new Map((previous[entity] ?? []).map(row => [row.Id, row]))
    const newRows = new Map((next[entity] ?? []).map(row => [row.Id, row]))
    for (const [id, row] of newRows) {
      const old = oldRows.get(id)
      if (old === undefined) {
        changed.push({ entity, id, operation: 'create' })
      } else if (
        JSON.stringify(old) !== JSON.stringify(row)
        || intents?.some(intent => intent.entity === entity && intent.id === id)
      ) {
        changed.push({ entity, id, operation: 'update' })
      }
    }
    for (const id of oldRows.keys()) {
      if (!newRows.has(id)) {
        changed.push({ entity, id, operation: 'delete' })
      }
    }
  }
  return changed
}
