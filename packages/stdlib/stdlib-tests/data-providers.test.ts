import TR from '@runtime/TR'
import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { InstantDBProvider } from '../@tao/data/providers/instantdb/InstantDB'
import { LocalProvider } from '../@tao/data/providers/local/Local'
import { MemoryProvider } from '../@tao/data/providers/memory/Memory'

Describe('@tao/data providers', () => {
  Test('publishes Memory through the provider conformance contract', async () => {
    await TR.testProvider(MemoryProvider, rejectingProvider)
  })

  Test('publishes Local through the provider conformance contract', async () => {
    const values = new Map<string, string>()
    await TR.testProvider(
      () => LocalProvider(() => mapStorage(values)),
      () => LocalProvider(() => rejectingStorage()),
    )
  })

  Test('connects InstantDB with evaluated config and forwards snapshot reads, writes, and subscriptions', async () => {
    const sdk = fakeInstantSDK()
    const provider = InstantDBProvider(() => sdk.instantSDK as never)
    const connection = provider.connect({
      configuration: {
        ApiURI: ' http://localhost:9020 ',
        AppId: ' app-id ',
        WebsocketURI: ' ws://localhost:9020/runtime/session ',
      },
      schema: { entities: {}, name: 'InstantTest' },
      storageKey: 'Notes',
    })
    const secondConnection = provider.connect({
      configuration: {
        ApiURI: 'http://localhost:9020',
        AppId: 'app-id',
        WebsocketURI: 'ws://localhost:9020/runtime/session',
      },
      schema: { entities: {}, name: 'InstantTest' },
      storageKey: 'OtherNotes',
    })

    Expect(sdk.initConfig).toMatchObject({
      apiURI: 'http://localhost:9020',
      appId: 'app-id',
      websocketURI: 'ws://localhost:9020/runtime/session',
    })

    // The load resolves from the first subscribeQuery result — the SDK's local cache — instead of
    // a queryOnce round-trip that hard-rejects offline.
    const loading = connection.load() as Promise<string | undefined>
    Expect(sdk.subscription).toBeDefined()
    sdk.subscription?.({ data: { taoSnapshots: [] } })
    Expect(await loading).toBeUndefined()

    await connection.save('{"snapshot":"saved"}')
    Expect(sdk.transactions).toHaveLength(1)
    Expect(sdk.transactions[0]).toMatchObject({
      fields: { Snapshot: '{"snapshot":"saved"}', StorageKey: 'Notes' },
    })
    Expect((sdk.transactions[0] as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    // A result arriving between load resolution and the runtime's subscribe replays on subscribe.
    sdk.subscription?.({ data: { taoSnapshots: [{ Snapshot: 'missed', StorageKey: 'Notes' }] } })
    const snapshots: Array<string | undefined> = []
    const errors: unknown[] = []
    const stop = connection.subscribe!({
      error: error => errors.push(error),
      snapshot: snapshot => snapshots.push(snapshot),
    })
    sdk.subscription?.({ data: { taoSnapshots: [{ Snapshot: 'remote', StorageKey: 'Notes' }] } })
    const remoteError = new Error('offline')
    sdk.subscription?.({ error: remoteError })
    stop()
    connection.close?.()

    Expect(snapshots).toEqual(['missed', 'remote'])
    Expect(errors).toEqual([remoteError])
    Expect(sdk.unsubscribeCalls).toBe(1)
    Expect(sdk.shutdownCalls).toBe(0)
    secondConnection.close?.()
    secondConnection.close?.()
    Expect(sdk.shutdownCalls).toBe(1)
  })

  Test('rejects the load when the first subscription result is an error or a key collision', async () => {
    const sdk = fakeInstantSDK()
    const provider = InstantDBProvider(() => sdk.instantSDK as never)
    const connect = (storageKey: string): TR.DataConnection =>
      provider.connect({
        configuration: { AppId: 'app-id' },
        schema: { entities: {}, name: 'InstantTest' },
        storageKey,
      })

    const failing = connect('Notes').load() as Promise<string | undefined>
    sdk.subscription?.({ error: { message: 'device is offline' } })
    await Expect(failing).rejects.toThrow('device is offline')

    const colliding = connect('Notes').load() as Promise<string | undefined>
    sdk.subscription?.({ data: { taoSnapshots: [{ Snapshot: 'x', StorageKey: 'OtherKey' }] } })
    await Expect(colliding).rejects.toThrow('deterministic snapshot key collision')
  })

  Test('counts core references across provider instances sharing one cached SDK core', () => {
    // @instantdb caches one core per equivalent init config, so two datasource declarations with
    // the same AppId hand their connections the same core object.
    const sdk = fakeInstantSDK()
    const context = {
      configuration: { AppId: 'app-id' },
      schema: { entities: {}, name: 'InstantTest' },
      storageKey: 'Notes',
    }
    const first = InstantDBProvider(() => sdk.instantSDK as never).connect(context)
    const second = InstantDBProvider(() => sdk.instantSDK as never).connect({
      ...context,
      storageKey: 'OtherNotes',
    })

    first.close?.()
    Expect(sdk.shutdownCalls).toBe(0)
    second.close?.()
    Expect(sdk.shutdownCalls).toBe(1)
  })

  Test('validates required InstantDB config before loading the native SDK', () => {
    let sdkLoads = 0
    const provider = InstantDBProvider(() => {
      sdkLoads += 1
      Errors.throwUnexpected('SDK should not load')
    })

    Expect(() =>
      provider.connect({
        configuration: {},
        schema: { entities: {}, name: 'InstantConfigTest' },
        storageKey: 'Notes',
      })
    ).toThrow("InstantDB datasource configuration 'AppId' expects non-empty text.")
    Expect(sdkLoads).toBe(0)
  })
})

type InstantSubscriptionResult = {
  data?: { taoSnapshots: Array<{ Snapshot: string; StorageKey: string }> }
  error?: unknown
}

/** fakeInstantSDK emulates the SDK boundary, including its one cached core per init config. */
function fakeInstantSDK(): {
  initConfig: Record<string, unknown> | undefined
  instantSDK: unknown
  shutdownCalls: number
  subscription: ((result: InstantSubscriptionResult) => void) | undefined
  transactions: unknown[]
  unsubscribeCalls: number
} {
  const state = {
    initConfig: undefined as Record<string, unknown> | undefined,
    shutdownCalls: 0,
    subscription: undefined as ((result: InstantSubscriptionResult) => void) | undefined,
    transactions: [] as unknown[],
    unsubscribeCalls: 0,
  }
  const core = {
    shutdown: () => {
      state.shutdownCalls += 1
    },
    subscribeQuery: (_query: unknown, observer: (result: InstantSubscriptionResult) => void) => {
      state.subscription = observer
      return () => {
        state.unsubscribeCalls += 1
      }
    },
  }
  const instantSDK = {
    i: {
      entity: (fields: unknown) => fields,
      schema: (definition: unknown) => definition,
      string: () => ({}),
    },
    init: (config: Record<string, unknown>) => {
      state.initConfig = config
      return {
        core,
        transact: async (transaction: unknown) => {
          state.transactions.push(transaction)
        },
        tx: {
          taoSnapshots: new Proxy({}, {
            get: (_target, id) => ({
              update: (fields: Record<string, unknown>) => ({ fields, id }),
            }),
          }),
        },
      }
    },
  }
  return {
    get initConfig() {
      return state.initConfig
    },
    instantSDK,
    get shutdownCalls() {
      return state.shutdownCalls
    },
    get subscription() {
      return state.subscription
    },
    get transactions() {
      return state.transactions
    },
    get unsubscribeCalls() {
      return state.unsubscribeCalls
    },
  }
}

function rejectingProvider(): TR.DataProvider {
  return {
    connect: () => ({
      load: () => undefined,
      save: () => {
        Errors.throwHostEnvironment('deterministic rejection')
      },
    }),
  }
}

function mapStorage(values: Map<string, string>): {
  getItem(key: string): Promise<string | null>
  removeItem(key: string): Promise<void>
  setItem(key: string, value: string): Promise<void>
} {
  return {
    getItem: async key => values.get(key) ?? null,
    removeItem: async key => {
      values.delete(key)
    },
    setItem: async (key, value) => {
      values.set(key, value)
    },
  }
}

function rejectingStorage(): ReturnType<typeof mapStorage> {
  return {
    getItem: async (_key: string) => null,
    removeItem: async (_key: string) => {},
    setItem: async (_key: string, _value: string) => {
      Errors.throwHostEnvironment('storage unavailable')
    },
  }
}
