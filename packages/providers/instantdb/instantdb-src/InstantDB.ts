import type TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import { optionalConfigurationText, requiredConfigurationText } from './provider-configuration'

const providerName = 'InstantDB'

type InstantSDK = typeof import('@instantdb/react-native')
type InstantDatabase = ReturnType<InstantSDK['init']>
type InstantCore = InstantDatabase['core']
type SnapshotRow = { Snapshot: string; StorageKey: string }
type SnapshotResult = {
  data?: { taoSnapshots?: readonly unknown[] }
  error?: unknown
}
type InstantCleanupFailure = Readonly<{ error: unknown; operation: 'shutdown' | 'unsubscribe' }>

// Instant caches one core per equivalent init config across every `init` call, so the reference
// count lives at module scope keyed by that shared core: closing the last connection of one
// provider instance must not shut a core down while another instance's connections still use it.
const clientReferences = new Map<InstantCore, number>()

const snapshotQuery = (entityId: string) =>
  ({
    taoSnapshots: {
      $: { where: { id: entityId } },
    },
  }) as const

/** InstantDBProvider synchronizes full datasource snapshots through the InstantDB client SDK. */
export function InstantDBProvider(loadSDK: () => InstantSDK = instantSDK): TR.DataProvider {
  return {
    testNetwork: true,
    connect: context => {
      const appId = requiredConfigurationText(providerName, context, 'AppId')
      const apiURI = optionalConfigurationText(providerName, context, 'ApiURI')
      const websocketURI = optionalConfigurationText(providerName, context, 'WebsocketURI')
      let db: InstantDatabase
      try {
        const { i, init } = loadSDK()
        const instantSchema = i.schema({
          entities: {
            taoSnapshots: i.entity({
              StorageKey: i.string(),
              Snapshot: i.string(),
            }),
          },
          links: {},
        })
        db = init({
          appId,
          schema: instantSchema,
          ...(apiURI === undefined ? {} : { apiURI }),
          ...(websocketURI === undefined ? {} : { websocketURI }),
        })
      } catch (error) {
        throw instantFailure('initialization', error)
      }
      clientReferences.set(db.core, (clientReferences.get(db.core) ?? 0) + 1)
      const entityId = deterministicEntityId(`${appId}:${context.storageKey}`)
      const query = snapshotQuery(entityId)
      let closed = false
      let observer: TR.DataConnectionObserver | undefined
      let missedResult: { error: unknown } | { snapshot: string | undefined } | undefined
      let rejectPendingLoad: ((error: Error) => void) | undefined
      let stopQuery: (() => void) | undefined
      const stopActiveQuery = (): InstantCleanupFailure | undefined => {
        const stop = stopQuery
        stopQuery = undefined
        try {
          stop?.()
          return undefined
        } catch (error) {
          return { error, operation: 'unsubscribe' }
        }
      }

      return {
        close: () => {
          if (closed) {
            return
          }
          closed = true
          const failures: InstantCleanupFailure[] = []
          const unsubscribeFailure = stopActiveQuery()
          if (unsubscribeFailure !== undefined) {
            failures.push(unsubscribeFailure)
          }
          rejectPendingLoad?.(
            new Errors.HostEnvironmentError('The InstantDB connection closed before its load settled.'),
          )
          rejectPendingLoad = undefined
          const remaining = (clientReferences.get(db.core) ?? 1) - 1
          if (remaining > 0) {
            clientReferences.set(db.core, remaining)
          } else {
            clientReferences.delete(db.core)
            try {
              db.core.shutdown()
            } catch (error) {
              failures.push({ error, operation: 'shutdown' })
            }
          }
          throwCleanupFailures(failures)
        },
        // The load resolves from the first subscribeQuery result and the subscription stays alive
        // for the connection's lifetime: unlike queryOnce, the subscription serves the SDK's local
        // cache when the device launches offline, and the runtime's own subscribe then reuses the
        // same stream instead of a second identical startup query.
        load: () =>
          new Promise<string | undefined>((resolve, reject) => {
            let settled = false
            const unsubscribeFailure = stopActiveQuery()
            rejectPendingLoad?.(new Errors.HostEnvironmentError('The InstantDB connection restarted its load.'))
            rejectPendingLoad = undefined
            if (unsubscribeFailure !== undefined) {
              reject(instantFailure(unsubscribeFailure.operation, unsubscribeFailure.error))
              return
            }
            rejectPendingLoad = error => {
              if (!settled) {
                settled = true
                reject(error)
              }
            }
            try {
              stopQuery = db.core.subscribeQuery(query, result => {
                const { error, snapshot } = readResult(result, context.storageKey)
                if (!settled) {
                  settled = true
                  rejectPendingLoad = undefined
                  if (error !== undefined) {
                    reject(instantFailure('load', error))
                  } else {
                    resolve(snapshot)
                  }
                  return
                }
                if (observer === undefined) {
                  // The runtime subscribes one microtask after load resolves; keep the latest result
                  // from that gap — an error included — so subscribe can replay it.
                  missedResult = error !== undefined
                    ? { error: instantFailure('subscription', error) }
                    : { snapshot }
                  return
                }
                if (error !== undefined) {
                  observer.error(instantFailure('subscription', error))
                } else {
                  observer.snapshot(snapshot)
                }
              })
            } catch (error) {
              rejectPendingLoad = undefined
              reject(instantFailure('subscription', error))
            }
          }),
        // The full envelope round-trips row ids untouched, so identity tokens restore across
        // relaunches exactly as for the local snapshot providers.
        referenceToken: reference => reference.id,
        resolveReference: reference => reference.token,
        save: async snapshot => {
          try {
            const snapshots = db.tx['taoSnapshots']
            if (snapshots === undefined) {
              Errors.throwHostEnvironment('The InstantDB transaction builder is unavailable.')
            }
            await db.transact(
              snapshots[entityId]!.update({
                Snapshot: snapshot,
                StorageKey: context.storageKey,
              }),
            )
          } catch (error) {
            throw instantFailure('save', error)
          }
        },
        subscribe: next => {
          observer = next
          const replay = missedResult
          missedResult = undefined
          if (replay !== undefined) {
            if ('error' in replay) {
              next.error(replay.error)
            } else {
              next.snapshot(replay.snapshot)
            }
          }
          return () => {
            if (observer === next) {
              observer = undefined
            }
          }
        },
      }
    },
  }
}

function readResult(
  result: SnapshotResult,
  storageKey: string,
): { error?: unknown; snapshot?: string | undefined } {
  if (result.error !== undefined) {
    return { error: result.error }
  }
  const row = result.data?.taoSnapshots?.[0]
  if (row !== undefined && !isSnapshotRow(row)) {
    return { error: new Errors.HostEnvironmentError('InstantDB returned a malformed snapshot row.') }
  }
  try {
    return { snapshot: snapshotFromRow(row, storageKey) }
  } catch (error) {
    return { error }
  }
}

function isSnapshotRow(value: unknown): value is SnapshotRow {
  return typeof value === 'object'
    && value !== null
    && 'Snapshot' in value
    && typeof value.Snapshot === 'string'
    && 'StorageKey' in value
    && typeof value.StorageKey === 'string'
}

function instantFailure(operation: string, error: unknown): Error {
  if (Errors.isTaoError(error)) {
    return error
  }
  return new Errors.HostEnvironmentError(`InstantDB ${operation} failed.`, { cause: error })
}

function throwCleanupFailures(failures: readonly InstantCleanupFailure[]): void {
  if (failures.length === 0) {
    return
  }
  if (failures.length === 1) {
    const [failure] = failures
    throw instantFailure(failure!.operation, failure!.error)
  }
  const operations = failures.map(failure => failure.operation).join(' and ')
  Errors.throwHostEnvironment(`InstantDB cleanup failed during ${operations}.`, { cause: failures })
}

function instantSDK(): InstantSDK {
  return require('@instantdb/react-native') as InstantSDK
}

function snapshotFromRow(
  row: SnapshotRow | undefined,
  storageKey: string,
): string | undefined {
  if (row === undefined) {
    return undefined
  }
  Assert(
    row.StorageKey === storageKey,
    'no InstantDB deterministic snapshot key collision',
    { rowStorageKey: row.StorageKey, storageKey },
  )
  return row.Snapshot
}

function deterministicEntityId(value: string): string {
  const compact = [0x811c9dc5, 0x9e3779b9, 0x243f6a88, 0xb7e15162]
    .map(seed => stableHash32(value, seed).toString(16).padStart(8, '0'))
    .join('')
  const versioned = `${compact.slice(0, 12)}8${compact.slice(13)}`
  const variant = ((Number.parseInt(versioned[16]!, 16) & 0x3) | 0x8).toString(16)
  const uuid = `${versioned.slice(0, 16)}${variant}${versioned.slice(17)}`
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`
}

function stableHash32(value: string, seed: number): number {
  let hash = seed
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193)
    hash = Math.imul(hash ^ (code >>> 8), 0x01000193)
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}
