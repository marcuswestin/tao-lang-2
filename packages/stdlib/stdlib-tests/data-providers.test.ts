import TR from '@runtime/TR'
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
    type InstantSubscriptionResult = {
      data?: { taoSnapshots: Array<{ Snapshot: string; StorageKey: string }> }
      error?: unknown
    }
    let subscription: ((result: InstantSubscriptionResult) => void) | undefined
    let initConfig: Record<string, unknown> | undefined
    let shutdownCalls = 0
    let unsubscribeCalls = 0
    const transactions: unknown[] = []
    const core = {
      shutdown: () => {
        shutdownCalls += 1
      },
      subscribeQuery: (_query: unknown, observer: (result: InstantSubscriptionResult) => void) => {
        subscription = observer
        return () => {
          unsubscribeCalls += 1
        }
      },
    }
    const db = {
      core,
      queryOnce: async (_query: unknown) => ({ data: { taoSnapshots: [] }, pageInfo: {} }),
      transact: async (transaction: unknown) => {
        transactions.push(transaction)
      },
      tx: {
        taoSnapshots: new Proxy({}, {
          get: (_target, id) => ({
            update: (fields: Record<string, unknown>) => ({ fields, id }),
          }),
        }),
      },
    }
    const instantSDK = {
      i: {
        entity: (fields: unknown) => fields,
        schema: (definition: unknown) => definition,
        string: () => ({}),
      },
      init: (config: Record<string, unknown>) => {
        initConfig = config
        return { ...db, core }
      },
    }
    const provider = InstantDBProvider(() => instantSDK as never)
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

    Expect(initConfig).toMatchObject({
      apiURI: 'http://localhost:9020',
      appId: 'app-id',
      websocketURI: 'ws://localhost:9020/runtime/session',
    })
    Expect(await connection.load()).toBeUndefined()
    await connection.save('{"snapshot":"saved"}')
    Expect(transactions).toHaveLength(1)
    Expect(transactions[0]).toMatchObject({
      fields: { Snapshot: '{"snapshot":"saved"}', StorageKey: 'Notes' },
    })
    Expect((transactions[0] as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    const snapshots: Array<string | undefined> = []
    const errors: unknown[] = []
    const stop = connection.subscribe!({
      error: error => errors.push(error),
      snapshot: snapshot => snapshots.push(snapshot),
    })
    subscription?.({ data: { taoSnapshots: [{ Snapshot: 'remote', StorageKey: 'Notes' }] } })
    const remoteError = new Error('offline')
    subscription?.({ error: remoteError })
    stop()
    connection.close?.()

    Expect(snapshots).toEqual(['remote'])
    Expect(errors).toEqual([remoteError])
    Expect(unsubscribeCalls).toBe(1)
    Expect(shutdownCalls).toBe(0)
    secondConnection.close?.()
    secondConnection.close?.()
    Expect(shutdownCalls).toBe(1)
  })

  Test('validates required InstantDB config before loading the native SDK', () => {
    let sdkLoads = 0
    const provider = InstantDBProvider(() => {
      sdkLoads += 1
      throw new Error('SDK should not load')
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

function rejectingProvider(): TR.DataProvider {
  return {
    connect: () => ({
      load: () => undefined,
      save: () => {
        throw new Error('deterministic rejection')
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
      throw new Error('storage unavailable')
    },
  }
}
