import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { acquireInstantClient } from '../instantdb-src/instant-clients'
import { InstantDBProvider } from '../instantdb-src/InstantDB'
import { notesSchema, publicNotesSchema } from './fixtures'

type Rows = Record<string, Record<string, unknown>[]>
type Chunk = Readonly<{ args?: unknown; id: string; namespace: string; op: string }>

let appCounter = 0
/** Every test takes its own app id, because the client registry is shared by the whole process. */
const nextAppId = (): string => `app-${++appCounter}`

function envelope(rows: Rows, nextId = 1): string {
  return JSON.stringify({ formatVersion: 1, nextId, rows, schemaVersion: 1 })
}

function connect(
  sdk: ReturnType<typeof fakeInstantSDK>,
  appId: string,
  schema: TR.DataSchemaDefinition = publicNotesSchema,
  extra: Partial<TR.DataProviderContext> = {},
): TR.DataConnection {
  return InstantDBProvider(() => sdk.instantSDK as never).connect({
    configuration: { AppId: appId },
    schema,
    storageKey: 'Notes',
    ...extra,
  })
}

async function loaded(sdk: ReturnType<typeof fakeInstantSDK>, connection: TR.DataConnection, data: unknown) {
  const loading = connection.load() as Promise<string | undefined>
  sdk.latestSubscription()({ data })
  return JSON.parse((await loading)!) as { nextId: number; rows: Rows }
}

Describe('InstantDB provider', () => {
  Test('shares one client per address, subscribes every namespace, and projects rows into a snapshot', async () => {
    const sdk = fakeInstantSDK()
    const appId = nextAppId()
    const first = InstantDBProvider(() => sdk.instantSDK as never).connect({
      configuration: {
        ApiURI: ' http://localhost:9020 ',
        AppId: ` ${appId} `,
        WebsocketURI: ' ws://localhost:9020/runtime/session ',
      },
      schema: publicNotesSchema,
      storageKey: 'Notes',
    })
    const second = InstantDBProvider(() => sdk.instantSDK as never).connect({
      configuration: {
        ApiURI: 'http://localhost:9020',
        AppId: appId,
        WebsocketURI: 'ws://localhost:9020/runtime/session',
      },
      schema: notesSchema,
      storageKey: 'Other',
    })

    Expect(sdk.inits).toHaveLength(2)
    Expect(sdk.inits[0]).toMatchObject({
      apiURI: 'http://localhost:9020',
      appId,
      websocketURI: 'ws://localhost:9020/runtime/session',
    })
    // The second datasource's namespaces join the first's on the one shared client.
    Expect(Object.keys((sdk.inits[1]!['schema'] as { entities: object }).entities).sort()).toEqual([
      '$users',
      'accounts',
      'notes',
      'tags',
    ])
    Expect(sdk.cores).toHaveLength(1)

    const loading = first.load() as Promise<string | undefined>
    Expect(sdk.core().queries.at(-1)).toEqual({
      notes: {},
      tags: { note: { $: { fields: ['id'] } } },
    })
    sdk.latestSubscription()({
      data: {
        notes: [{ body: 'hello', id: uuid(1), pinned: true, ref: 'EXT-1' }],
        tags: [{ id: uuid(2), label: 'first', note: [{ id: uuid(1) }] }],
      },
    })
    Expect(JSON.parse((await loading)!)).toEqual({
      formatVersion: 1,
      nextId: 1,
      rows: {
        Note: [{ Body: 'hello', Id: uuid(1), Pinned: true, Ref: 'EXT-1' }],
        Tag: [{ Id: uuid(2), Label: 'first', Note: uuid(1) }],
      },
      schemaVersion: 1,
    })

    // A result between load and the runtime's subscribe replays on subscribe, errors included.
    sdk.latestSubscription()({ data: { notes: [], tags: [] } })
    const snapshots: Rows[] = []
    const errors: unknown[] = []
    const stop = first.subscribe!({
      error: error => errors.push(error),
      snapshot: snapshot => snapshots.push((JSON.parse(snapshot!) as { rows: Rows }).rows),
    })
    Expect(snapshots).toEqual([{ Note: [], Tag: [] }])
    sdk.latestSubscription()({ data: { notes: [], tags: [] } })
    Expect(snapshots).toHaveLength(1)
    sdk.latestSubscription()({ error: { message: 'offline' } })
    Expect(errors).toHaveLength(1)
    Expect(Errors.messageOf(errors[0])).toBe('InstantDB subscription failed.')
    stop()

    first.close?.()
    Expect(sdk.core().unsubscribes).toBe(1)
    Expect(sdk.core().shutdowns).toBe(0)
    second.close?.()
    second.close?.()
    Expect(sdk.core().shutdowns).toBe(1)
  })

  Test('turns each save into one transaction of per-row creates, field updates, links, and deletes', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId())
    const empty = await loaded(sdk, connection, { notes: [], tags: [] })

    const created = envelope({
      Note: [{ Body: 'hello', Id: 'Note-1', Pinned: false, Ref: null }],
      Tag: [{ Id: 'Tag-1', Label: 'first', Note: 'Note-1' }],
    }, 3)
    await connection.save(created, [], { previousSnapshot: envelope(empty.rows) })
    Expect(sdk.core().transactions).toEqual([[
      { args: { body: 'hello', pinned: false }, id: uuid(101), namespace: 'notes', op: 'update' },
      { args: { label: 'first' }, id: uuid(102), namespace: 'tags', op: 'update' },
      { args: { note: uuid(101) }, id: uuid(102), namespace: 'tags', op: 'link' },
    ]])

    // Only changed fields travel, plus any field an intent says the author set to its old value.
    const edited = envelope({
      Note: [
        { Body: 'hello', Id: 'Note-1', Pinned: true, Ref: 'EXT-1' },
        { Body: 'second', Id: 'Note-2', Pinned: false, Ref: null },
      ],
      Tag: [{ Id: 'Tag-1', Label: 'first', Note: 'Note-2' }],
    }, 3)
    await connection.save(edited, [{ entity: 'Note', fields: ['Body'], id: 'Note-1' }], {
      previousSnapshot: created,
    })
    Expect(sdk.core().transactions[1]).toEqual([
      { args: { body: 'hello', pinned: true, ref: 'EXT-1' }, id: uuid(101), namespace: 'notes', op: 'update' },
      { args: { body: 'second', pinned: false }, id: uuid(103), namespace: 'notes', op: 'update' },
      { args: { note: uuid(103) }, id: uuid(102), namespace: 'tags', op: 'link' },
    ])

    await connection.save(
      envelope({ Note: [{ Body: 'second', Id: 'Note-2', Pinned: false, Ref: null }], Tag: [] }),
      [],
      {
        previousSnapshot: edited,
      },
    )
    Expect(sdk.core().transactions[2]).toEqual([
      { id: uuid(101), namespace: 'notes', op: 'delete' },
      { id: uuid(102), namespace: 'tags', op: 'delete' },
    ])

    // A save that changes nothing sends nothing.
    await connection.save(edited, [], { previousSnapshot: edited })
    Expect(sdk.core().transactions).toHaveLength(3)

    // The authority's rows project back under the ids the store created them with, and keep
    // the store's row order; the id counter follows the latest save.
    sdk.latestSubscription()({
      data: {
        notes: [
          { body: 'second', id: uuid(103), pinned: false },
          { body: 'hello', id: uuid(101), pinned: true, ref: 'EXT-1' },
          { body: 'peer', id: uuid(7), pinned: false },
        ],
        tags: [{ id: uuid(102), label: 'first', note: { id: uuid(103) } }],
      },
    })
    const published: string[] = []
    connection.subscribe!({ error: () => {}, snapshot: snapshot => published.push(snapshot!) })
    Expect(JSON.parse(published[0]!)).toMatchObject({
      nextId: 3,
      rows: {
        Note: [
          { Id: 'Note-1' },
          { Id: 'Note-2' },
          { Body: 'peer', Id: uuid(7) },
        ],
        Tag: [{ Id: 'Tag-1', Note: 'Note-2' }],
      },
    })
    Expect(connection.referenceToken!({ entity: 'Note', id: 'Note-1', schema: 'InstantPublicNotes' })).toBe(uuid(101))
    Expect(connection.resolveReference!({ entity: 'Note', schema: 'InstantPublicNotes', token: uuid(101) })).toBe(
      'Note-1',
    )
    Expect(connection.resolveReference!({ entity: 'Note', schema: 'InstantPublicNotes', token: uuid(7) })).toBe(
      uuid(7),
    )
    connection.close?.()
  })

  Test('clears an optional relation with an unlink and keeps a UUID row id as its own', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId(), notesSchema)
    const account = { DisplayName: 'Alice', Id: uuid(50) }
    const note = { Body: 'b', CreatedAt: 1, Id: uuid(51), Owner: uuid(50), Pinned: false, Status: 'Draft' }
    const tag = { Id: uuid(52), Label: 'x', Note: uuid(51) }
    const before = envelope({ Account: [account], Note: [note], Tag: [tag] })
    await connection.save(envelope({ Account: [account], Note: [note], Tag: [{ ...tag, Note: null }] }), [], {
      previousSnapshot: before,
    })
    Expect(sdk.core().transactions).toEqual([[
      { args: { note: uuid(51) }, id: uuid(52), namespace: 'tags', op: 'unlink' },
    ]])
    connection.close?.()
  })

  Test('reads absent or mistyped values as defaults and leaves out rows whose required relation is gone', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId(), notesSchema)
    const snapshot = await loaded(sdk, connection, {
      accounts: [{ id: uuid(1) }],
      notes: [
        { body: 42, id: uuid(2), owner: [{ id: uuid(1) }], status: 'Unknown' },
        { body: 'orphan', id: uuid(3), owner: [] },
        { body: 'foreign', id: uuid(4), owner: { id: uuid(9) } },
      ],
      tags: [
        { id: uuid(5), label: 'kept', note: [{ id: uuid(2) }] },
        { id: uuid(6), label: 'loose', note: [{ id: uuid(3) }] },
      ],
    })
    Expect(snapshot.rows).toEqual({
      Account: [{ DisplayName: null, Id: uuid(1) }],
      Note: [{ Body: '', CreatedAt: 0, Id: uuid(2), Owner: uuid(1), Pinned: false, Status: 'Draft' }],
      // The optional relation to a left-out note reads as empty.
      Tag: [
        { Id: uuid(5), Label: 'kept', Note: uuid(2) },
        { Id: uuid(6), Label: 'loose', Note: null },
      ],
    })
    connection.close?.()

    // A signed-in store keeps a row whose related row this account cannot read.
    const authenticated = connect(sdk, nextAppId(), notesSchema, { auth: {} as never })
    const partial = await loaded(sdk, authenticated, {
      notes: [{ body: 'shared', id: uuid(4), owner: { id: uuid(9) } }],
    })
    Expect(partial.rows['Note']).toEqual([
      { Body: 'shared', CreatedAt: 0, Id: uuid(4), Owner: uuid(9), Pinned: false, Status: 'Draft' },
    ])
    authenticated.close?.()
  })

  Test('names a server refusal by kind and keeps the raw failure out of the message', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId())
    const before = envelope({ Note: [], Tag: [] })
    const after = envelope({ Note: [{ Body: 'x', Id: 'Note-1', Pinned: false, Ref: null }], Tag: [] })

    sdk.core().failTransactionsWith({ body: { message: 'token=hidden', type: 'permission-denied' }, status: 400 })
    const refused = connection.save(after, [], { previousSnapshot: before }) as Promise<void>
    await Expect(refused).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
    await Expect(refused).rejects.toThrow('InstantDB save failed (permission-denied).')

    sdk.core().failTransactionsWith({ body: { type: 'Not A Kind; token=hidden' } })
    const raw = connection.save(after, [], { previousSnapshot: before }) as Promise<void>
    await Expect(raw).rejects.toThrow(/^InstantDB save failed\.$/)

    const categorized = new Errors.UserInputError('A categorized failure.')
    sdk.core().failTransactionsWith(categorized)
    await Expect(connection.save(after, [], { previousSnapshot: before }) as Promise<void>).rejects.toBe(categorized)
    connection.close?.()
  })

  Test('classifies load failures and recovers a load after an unsubscribe failure', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId())
    const failing = connection.load() as Promise<string | undefined>
    sdk.latestSubscription()({ error: { message: 'device is offline' } })
    await Expect(failing).rejects.toThrow('InstantDB load failed.')
    await Expect(failing).rejects.toBeInstanceOf(Errors.HostEnvironmentError)

    sdk.core().failNextUnsubscribeWith({ message: 'raw unsubscribe detail' })
    await Expect(connection.load() as Promise<string | undefined>).rejects.toThrow('InstantDB unsubscribe failed.')

    const recovered = connection.load() as Promise<string | undefined>
    sdk.latestSubscription()({ data: { notes: [{ body: 'back', id: uuid(1) }] } })
    Expect(JSON.parse((await recovered)!).rows.Note).toEqual([{ Body: 'back', Id: uuid(1), Pinned: false, Ref: null }])
    connection.close?.()
  })

  Test('aggregates unsubscribe and shutdown failures on close', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId())
    await loaded(sdk, connection, {})
    sdk.core().failNextUnsubscribeWith(Errors.abortError('raw unsubscribe failure'))
    sdk.core().failNextShutdownWith('raw shutdown failure')
    Expect(() => connection.close?.()).toThrow('InstantDB cleanup failed during unsubscribe and shutdown.')
    Expect(sdk.core().shutdowns).toBe(1)
    connection.close?.()
    Expect(sdk.core().shutdowns).toBe(1)

    const categorized = new Errors.UnexpectedBehaviorError('Categorized shutdown failure.')
    const other = connect(sdk, nextAppId())
    sdk.core().failNextShutdownWith(categorized)
    let closeError: unknown
    try {
      other.close?.()
    } catch (error) {
      closeError = error
    }
    Expect(closeError).toBe(categorized)
  })

  Test('validates required configuration and the schema mapping before loading the SDK', () => {
    let sdkLoads = 0
    const provider = InstantDBProvider(() => {
      sdkLoads += 1
      return Errors.throwUnexpected('SDK should not load')
    })
    Expect(() => provider.connect({ configuration: {}, schema: publicNotesSchema, storageKey: 'Notes' })).toThrow(
      "InstantDB datasource configuration 'AppId' expects non-empty text.",
    )
    const compound = structuredClone(publicNotesSchema)
    compound.entities['Tag'] = { ...compound.entities['Tag']!, uniqueConstraints: [['Label', 'Note']] }
    Expect(() => provider.connect({ configuration: { AppId: 'a' }, schema: compound, storageKey: 'Notes' })).toThrow(
      "compound unique constraint 'Tag.Label + Note'",
    )
    Expect(sdkLoads).toBe(0)
  })
})

Describe('InstantDB client registry', () => {
  Test('keys clients by app and endpoints, counts leases, and releases once', () => {
    const sdk = fakeInstantSDK()
    const appId = nextAppId()
    const local = acquireInstantClient(sdk.instantSDK as never, { apiURI: 'http://localhost:9020', appId })
    const again = acquireInstantClient(sdk.instantSDK as never, { apiURI: 'http://localhost:9020', appId })
    const hosted = acquireInstantClient(sdk.instantSDK as never, { appId })
    Expect(again.db.core).toBe(local.db.core)
    Expect(hosted.db.core).not.toBe(local.db.core)
    // A lease without a schema reuses the client instead of calling init again.
    Expect(sdk.inits).toHaveLength(2)

    local.release()
    local.release()
    Expect(sdk.cores[0]!.shutdowns).toBe(0)
    again.release()
    Expect(sdk.cores[0]!.shutdowns).toBe(1)
    hosted.release()
    Expect(sdk.cores[1]!.shutdowns).toBe(1)
  })
})

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

type FakeCore = ReturnType<typeof fakeCore>

function fakeCore() {
  const state = {
    queries: [] as unknown[],
    shutdownFailure: undefined as { error: unknown } | undefined,
    shutdowns: 0,
    subscriptions: [] as ((result: unknown) => void)[],
    transactionFailure: undefined as { error: unknown } | undefined,
    transactions: [] as Chunk[][],
    unsubscribeFailure: undefined as { error: unknown } | undefined,
    unsubscribes: 0,
  }
  return {
    failNextShutdownWith: (error: unknown) => {
      state.shutdownFailure = { error }
    },
    failNextUnsubscribeWith: (error: unknown) => {
      state.unsubscribeFailure = { error }
    },
    failTransactionsWith: (error: unknown) => {
      state.transactionFailure = { error }
    },
    get queries() {
      return state.queries
    },
    get shutdowns() {
      return state.shutdowns
    },
    shutdown: () => {
      state.shutdowns += 1
      const failure = state.shutdownFailure
      state.shutdownFailure = undefined
      if (failure !== undefined) {
        throw failure.error
      }
    },
    subscribeQuery: (query: unknown, callback: (result: unknown) => void) => {
      state.queries.push(query)
      state.subscriptions.push(callback)
      return () => {
        state.unsubscribes += 1
        const failure = state.unsubscribeFailure
        state.unsubscribeFailure = undefined
        if (failure !== undefined) {
          throw failure.error
        }
      }
    },
    get subscriptions() {
      return state.subscriptions
    },
    transact: async (chunks: Chunk[]) => {
      if (state.transactionFailure !== undefined) {
        throw state.transactionFailure.error
      }
      state.transactions.push(chunks)
      return { status: 'synced' }
    },
    get transactions() {
      return state.transactions
    },
    get unsubscribes() {
      return state.unsubscribes
    },
  }
}

/** fakeInstantSDK emulates the SDK boundary, including its one cached core per init config. */
function fakeInstantSDK() {
  const cores = new Map<string, FakeCore>()
  const inits: Record<string, unknown>[] = []
  let minted = 100
  const attribute = (valueType: string): Record<string, unknown> => {
    const definition: Record<string, unknown> = { valueType }
    return Object.assign(definition, {
      indexed: () => Object.assign(definition, { indexed: true }),
      optional: () => definition,
      unique: () => Object.assign(definition, { unique: true }),
    })
  }
  const row = (namespace: string, id: string) => ({
    delete: () => ({ id, namespace, op: 'delete' }),
    link: (args: unknown) => ({ args, id, namespace, op: 'link' }),
    unlink: (args: unknown) => ({ args, id, namespace, op: 'unlink' }),
    update: (args: unknown) => ({ args, id, namespace, op: 'update' }),
  })
  const instantSDK = {
    i: {
      boolean: () => attribute('boolean'),
      entity: (attrs: unknown) => ({ attrs }),
      json: () => attribute('json'),
      number: () => attribute('number'),
      schema: (definition: unknown) => definition,
      string: () => attribute('string'),
    },
    id: () => uuid(++minted),
    init: (config: Record<string, unknown>) => {
      inits.push(config)
      const key = JSON.stringify([config['appId'], config['apiURI'], config['websocketURI']])
      const core = cores.get(key) ?? fakeCore()
      cores.set(key, core)
      return { core }
    },
    tx: new Proxy({}, {
      get: (_target, namespace) => new Proxy({}, { get: (_rows, id) => row(String(namespace), String(id)) }),
    }),
  }
  return {
    core: (): FakeCore => [...cores.values()].at(-1)!,
    get cores() {
      return [...cores.values()]
    },
    inits,
    instantSDK,
    latestSubscription: () => [...cores.values()].at(-1)!.subscriptions.at(-1)!,
  }
}
