import type TR from '@runtime/TR'

type InstantSDK = typeof import('@instantdb/react-native')
type InstantDatabase = ReturnType<InstantSDK['init']>
type InstantCore = InstantDatabase['core']
type SnapshotRow = { Snapshot: string; StorageKey: string }
type SnapshotResult = {
  data?: { taoSnapshots: SnapshotRow[] }
  error?: unknown
}

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
    connect: context => {
      const appId = requiredConfigurationText(context, 'AppId')
      const apiURI = optionalConfigurationText(context, 'ApiURI')
      const websocketURI = optionalConfigurationText(context, 'WebsocketURI')
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
      const db = init({
        appId,
        schema: instantSchema,
        ...(apiURI === undefined ? {} : { apiURI }),
        ...(websocketURI === undefined ? {} : { websocketURI }),
      })
      clientReferences.set(db.core, (clientReferences.get(db.core) ?? 0) + 1)
      const entityId = deterministicEntityId(`${appId}:${context.storageKey}`)
      const query = snapshotQuery(entityId)
      let closed = false
      let observer: TR.DataConnectionObserver | undefined
      let missedSnapshot: { value: string | undefined } | undefined
      let stopQuery: (() => void) | undefined

      return {
        close: () => {
          if (closed) {
            return
          }
          closed = true
          stopQuery?.()
          stopQuery = undefined
          const remaining = (clientReferences.get(db.core) ?? 1) - 1
          if (remaining > 0) {
            clientReferences.set(db.core, remaining)
            return
          }
          clientReferences.delete(db.core)
          db.core.shutdown()
        },
        // The load resolves from the first subscribeQuery result and the subscription stays alive
        // for the connection's lifetime: unlike queryOnce, the subscription serves the SDK's local
        // cache when the device launches offline, and the runtime's own subscribe then reuses the
        // same stream instead of a second identical startup query.
        load: () =>
          new Promise<string | undefined>((resolve, reject) => {
            let settled = false
            stopQuery?.()
            stopQuery = db.core.subscribeQuery(query, result => {
              const { error, snapshot } = readResult(result, context.storageKey)
              if (!settled) {
                settled = true
                if (error !== undefined) {
                  reject(toError(error))
                } else {
                  resolve(snapshot)
                }
                return
              }
              if (observer === undefined) {
                // The runtime subscribes one microtask after load resolves; keep the latest result
                // from that gap so subscribe can replay it.
                missedSnapshot = error === undefined ? { value: snapshot } : missedSnapshot
                return
              }
              if (error !== undefined) {
                observer.error(error)
              } else {
                observer.snapshot(snapshot)
              }
            })
          }),
        save: async snapshot => {
          await db.transact(
            db.tx.taoSnapshots[entityId]!.update({
              Snapshot: snapshot,
              StorageKey: context.storageKey,
            }),
          )
        },
        subscribe: next => {
          observer = next
          const replay = missedSnapshot
          missedSnapshot = undefined
          if (replay !== undefined) {
            next.snapshot(replay.value)
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
  try {
    return { snapshot: snapshotFromRow(result.data?.taoSnapshots[0], storageKey) }
  } catch (error) {
    return { error }
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error)
  return new Error(message)
}

function instantSDK(): InstantSDK {
  return require('@instantdb/react-native') as InstantSDK
}

function requiredConfigurationText(context: TR.DataProviderContext, name: string): string {
  const value = context.configuration[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`InstantDB datasource configuration '${name}' expects non-empty text.`)
  }
  return value.trim()
}

function optionalConfigurationText(context: TR.DataProviderContext, name: string): string | undefined {
  const value = context.configuration[name]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`InstantDB datasource configuration '${name}' expects non-empty text when provided.`)
  }
  return value.trim()
}

function snapshotFromRow(
  row: SnapshotRow | undefined,
  storageKey: string,
): string | undefined {
  if (row === undefined) {
    return undefined
  }
  if (row.StorageKey !== storageKey) {
    throw new Error('InstantDB datasource detected a deterministic snapshot key collision.')
  }
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
