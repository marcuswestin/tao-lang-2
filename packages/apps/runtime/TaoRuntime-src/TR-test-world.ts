import type { TaoDataConnection, TaoDataWriteIntent } from './TR-data'
import type { TaoSyncWriteRecovery } from './TR-data-sync'
import { UserInputError } from './TR-errors'

type Failure = { entity: string; message: string; operation: 'create' | 'delete' | 'update' }
type Pending = { entity: string; id: string; message?: string; sequence: number }
type TestConnection = TaoDataConnection & { failure?: string; notify(): void; pending: Pending[] }

let online = true
let failure: Failure | undefined
let sequence = 0
const connections = new Set<TestConnection>()

/** TestWorld is the per-journey provider stand-in, isolated from installed provider transport. */
export const TestWorld = {
  begin(): void {
    online = true
    failure = undefined
    sequence = 0
    connections.clear()
  },
  end(): void {
    connections.clear()
    failure = undefined
    online = true
  },
  network(mode: 'offline' | 'online'): void {
    online = mode === 'online'
    if (online) {
      for (const connection of connections) {
        connection.pending.splice(
          0,
          connection.pending.length,
          ...connection.pending.filter(write => write.message !== undefined),
        )
        connection.notify()
      }
    }
  },
  failAfter(operation: Failure['operation'], entity: string, message: string): void {
    failure = { entity, message, operation }
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
  connection(granular = false): TaoDataConnection {
    let stored: string | undefined
    const pending: Pending[] = []
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
          pending.splice(0, pending.length, ...pending.filter(write => write.sequence !== submission))
          notify()
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
      load: () => stored,
      notify,
      pending,
      referenceToken: reference => reference.id,
      resolveReference: reference => reference.token,
      save(snapshot, intents) {
        const changed = changedRows(stored, snapshot, intents)
        const matched = changed.find(write =>
          failure !== undefined
          && write.entity === failure.entity && write.operation === failure.operation
        )
        const message = matched === undefined ? undefined : failure?.message
        if (matched !== undefined) {
          failure = undefined
        }
        if (!granular && (!online || message !== undefined)) {
          connection.failure = message ?? 'Network is offline.'
          throw new UserInputError(connection.failure)
        }
        stored = snapshot
        if (!granular) {
          connection.failure = undefined
        }
        if (granular) {
          const submission = ++sequence
          for (const write of changed) {
            if (!online || matched !== undefined) {
              pending.push({
                entity: write.entity,
                id: write.id,
                sequence: submission,
                ...(message !== undefined ? { message } : {}),
              })
            }
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
