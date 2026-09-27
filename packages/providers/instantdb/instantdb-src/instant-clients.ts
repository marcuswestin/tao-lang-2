import type { InstantAttribute, InstantSchemaJSON } from './instant-schema'

/**
 * One InstantDB client per (AppId, ApiURI, WebsocketURI), shared by every datasource and, later, by
 * the InstantDB auth provider: a sign-in on the shared client is what authenticates the data
 * subscriptions. The SDK itself caches one core per equivalent init config, so the registry mirrors
 * that key, counts leases, and shuts the core down when the last lease is released.
 *
 * Each datasource contributes its namespaces; the client runs with the union, because the SDK
 * holds one schema per core and replaces it on every `init` that passes a different one.
 */

/** InstantSDK is the part of `@instantdb/react-native` the provider and registry use. */
export type InstantSDK = Pick<typeof import('@instantdb/react-native'), 'i' | 'id' | 'init' | 'tx'>

/** InstantDatabase is one shared client as `init` returns it. */
export type InstantDatabase = ReturnType<InstantSDK['init']>

/** InstantClientAddress is the registry key: the app and the endpoints that reach it. */
export type InstantClientAddress = Readonly<{
  apiURI?: string | undefined
  appId: string
  websocketURI?: string | undefined
}>

/** InstantClientLease holds the shared client until `release`, which runs at most once. */
export type InstantClientLease = Readonly<{
  db: InstantDatabase
  release(): void
}>

type ClientEntry = {
  db: InstantDatabase
  leases: number
  schemas: Map<symbol, InstantSchemaJSON>
}

const clients = new Map<string, ClientEntry>()

/** acquireInstantClient leases the shared client for an address, adding a schema contribution. */
export function acquireInstantClient(
  sdk: InstantSDK,
  address: InstantClientAddress,
  schema?: InstantSchemaJSON,
): InstantClientLease {
  const key = JSON.stringify([address.appId, address.apiURI ?? null, address.websocketURI ?? null])
  const contribution = Symbol('InstantDB schema contribution')
  const existing = clients.get(key)
  const schemas = new Map(existing?.schemas ?? [])
  if (schema !== undefined) {
    schemas.set(contribution, schema)
  }
  // `init` returns the SDK's cached core for an equivalent config and updates its schema, so it is
  // called whenever the union changes, not only for the first lease.
  const db = existing !== undefined && schema === undefined
    ? existing.db
    : sdk.init({
      appId: address.appId,
      ...(address.apiURI === undefined ? {} : { apiURI: address.apiURI }),
      ...(address.websocketURI === undefined ? {} : { websocketURI: address.websocketURI }),
      ...(schemas.size === 0 ? {} : { schema: sdkSchema(sdk, mergeSchemas([...schemas.values()])) }),
    })
  const entry: ClientEntry = existing ?? { db, leases: 0, schemas }
  entry.db = db
  entry.leases += 1
  entry.schemas = schemas
  clients.set(key, entry)
  let released = false
  return {
    db,
    release: () => {
      if (released) {
        return
      }
      released = true
      entry.schemas.delete(contribution)
      entry.leases -= 1
      if (entry.leases > 0) {
        return
      }
      clients.delete(key)
      entry.db.core.shutdown()
    },
  }
}

function mergeSchemas(schemas: readonly InstantSchemaJSON[]): InstantSchemaJSON {
  return {
    entities: Object.assign({}, ...schemas.map(schema => schema.entities)),
    links: Object.assign({}, ...schemas.map(schema => schema.links)),
  }
}

function sdkSchema(sdk: InstantSDK, schema: InstantSchemaJSON) {
  const attribute = (definition: InstantAttribute) => {
    const base = {
      boolean: () => sdk.i.boolean(),
      json: () => sdk.i.json(),
      number: () => sdk.i.number(),
      string: () => sdk.i.string(),
    }[definition.valueType]().optional()
    const indexed = definition.config.indexed ? base.indexed() : base
    return definition.config.unique ? indexed.unique() : indexed
  }
  return sdk.i.schema({
    entities: Object.fromEntries(
      Object.entries(schema.entities).map(([namespace, entity]) => [
        namespace,
        sdk.i.entity(Object.fromEntries(
          Object.entries(entity.attrs).map(([label, definition]) => [
            label,
            attribute(definition),
          ]),
        )),
      ]),
    ),
    links: schema.links as never,
    rooms: {},
  })
}
