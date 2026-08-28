import type TR from '@runtime/TR'

type InstantSDK = typeof import('@instantdb/react-native')
type InstantDatabase = ReturnType<InstantSDK['init']>
type InstantCore = InstantDatabase['core']

const snapshotQuery = (entityId: string) =>
  ({
    taoSnapshots: {
      $: { where: { id: entityId } },
    },
  }) as const

/** InstantDBProvider synchronizes full datasource snapshots through the InstantDB client SDK. */
export function InstantDBProvider(loadSDK: () => InstantSDK = instantSDK): TR.DataProvider {
  // Instant returns a fresh React wrapper around a cached core for equivalent init config. Reference
  // the core itself so closing an outgoing wrapper cannot shut down a newly connected wrapper.
  const clientReferences = new Map<InstantCore, number>()
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

      return {
        close: () => {
          if (closed) {
            return
          }
          closed = true
          const remaining = (clientReferences.get(db.core) ?? 1) - 1
          if (remaining > 0) {
            clientReferences.set(db.core, remaining)
            return
          }
          clientReferences.delete(db.core)
          db.core.shutdown()
        },
        load: async () => {
          const result = await db.queryOnce(query)
          return snapshotFromRow(result.data.taoSnapshots[0], context.storageKey)
        },
        save: async snapshot => {
          await db.transact(
            db.tx.taoSnapshots[entityId]!.update({
              Snapshot: snapshot,
              StorageKey: context.storageKey,
            }),
          )
        },
        subscribe: observer =>
          db.core.subscribeQuery(query, result => {
            if (result.error !== undefined) {
              observer.error(result.error)
              return
            }
            try {
              observer.snapshot(snapshotFromRow(result.data.taoSnapshots[0], context.storageKey))
            } catch (error) {
              observer.error(error)
            }
          }),
      }
    },
  }
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
  row: { Snapshot: string; StorageKey: string } | undefined,
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
