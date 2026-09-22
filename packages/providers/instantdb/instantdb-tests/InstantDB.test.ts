import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { InstantDBProvider } from '../instantdb-src/InstantDB'

Describe('InstantDB provider', () => {
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
    Expect(errors).toHaveLength(1)
    Expect(errors[0]).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(Errors.messageOf(errors[0])).toBe('InstantDB subscription failed.')
    Expect(sdk.unsubscribeCalls).toBe(1)
    Expect(sdk.shutdownCalls).toBe(0)
    secondConnection.close?.()
    secondConnection.close?.()
    Expect(sdk.shutdownCalls).toBe(1)
  })

  Test('classifies InstantDB boundary failures while preserving Tao error categories', async () => {
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
    await Expect(failing).rejects.toThrow('InstantDB load failed.')
    await Expect(failing).rejects.toBeInstanceOf(Errors.HostEnvironmentError)

    const colliding = connect('Notes').load() as Promise<string | undefined>
    sdk.subscription?.({ data: { taoSnapshots: [{ Snapshot: 'x', StorageKey: 'OtherKey' }] } })
    await Expect(colliding).rejects.toThrow('deterministic snapshot key collision')
    await Expect(colliding).rejects.toBeInstanceOf(Errors.UnexpectedBehaviorError)

    const categorized = new Errors.UserInputError('A categorized author failure.')
    const categorizedLoad = connect('Notes').load() as Promise<string | undefined>
    sdk.subscription?.({ error: categorized })
    await Expect(categorizedLoad).rejects.toBe(categorized)

    const saving = connect('Notes')
    sdk.failTransactionsWith(`token=hidden[31m${'x'.repeat(400)}`)
    let saveError: unknown
    try {
      await saving.save('snapshot')
    } catch (error) {
      saveError = error
    }
    Expect(saveError).toBeInstanceOf(Errors.HostEnvironmentError)
    const message = Errors.messageOf(saveError)
    Expect(message).toBe('InstantDB save failed.')
    Expect(message.includes('hidden')).toBe(false)
  })

  Test('recovers repeated loads and completes close after unsubscribe failures', async () => {
    const sdk = fakeInstantSDK()
    const provider = InstantDBProvider(() => sdk.instantSDK as never)
    const connection = provider.connect({
      configuration: { AppId: 'app-id' },
      schema: { entities: {}, name: 'InstantTest' },
      storageKey: 'Notes',
    })
    const initial = connection.load() as Promise<string | undefined>
    sdk.subscription?.({ data: { taoSnapshots: [] } })
    await initial

    sdk.failNextUnsubscribeWith({ message: 'raw unsubscribe detail' })
    await Expect(connection.load()).rejects.toThrow('InstantDB unsubscribe failed.')

    const recovered = connection.load() as Promise<string | undefined>
    sdk.subscription?.({ data: { taoSnapshots: [{ Snapshot: 'recovered', StorageKey: 'Notes' }] } })
    Expect(await recovered).toBe('recovered')

    const categorized = new Errors.UserInputError('Categorized unsubscribe failure.')
    sdk.failNextUnsubscribeWith(categorized)
    let closeError: unknown
    try {
      connection.close?.()
    } catch (error) {
      closeError = error
    }
    Expect(closeError).toBe(categorized)
    Expect(sdk.shutdownCalls).toBe(1)
    connection.close?.()
    Expect(sdk.shutdownCalls).toBe(1)
  })

  Test('aggregates unsubscribe and shutdown failures without stranding shared lifecycle state', async () => {
    const sdk = fakeInstantSDK()
    const provider = InstantDBProvider(() => sdk.instantSDK as never)
    const connect = (): TR.DataConnection =>
      provider.connect({
        configuration: { AppId: 'app-id' },
        schema: { entities: {}, name: 'InstantTest' },
        storageKey: 'Notes',
      })

    const failing = connect()
    const loading = failing.load() as Promise<string | undefined>
    sdk.subscription?.({ data: { taoSnapshots: [] } })
    await loading
    sdk.failNextUnsubscribeWith(Errors.abortError('raw unsubscribe failure'))
    sdk.failNextShutdownWith('raw shutdown failure')
    let aggregate: unknown
    try {
      failing.close?.()
    } catch (error) {
      aggregate = error
    }
    Expect(aggregate).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(Errors.messageOf(aggregate)).toBe('InstantDB cleanup failed during unsubscribe and shutdown.')
    Expect(sdk.shutdownCalls).toBe(1)
    failing.close?.()
    Expect(sdk.shutdownCalls).toBe(1)

    const rawShutdown = connect()
    sdk.failNextShutdownWith(Errors.abortError('raw shutdown detail'))
    Expect(() => rawShutdown.close?.()).toThrow('InstantDB shutdown failed.')

    const categorizedShutdown = new Errors.UnexpectedBehaviorError('Categorized shutdown failure.')
    const categorized = connect()
    sdk.failNextShutdownWith(categorizedShutdown)
    let categorizedError: unknown
    try {
      categorized.close?.()
    } catch (error) {
      categorizedError = error
    }
    Expect(categorizedError).toBe(categorizedShutdown)

    connect().close?.()
    Expect(sdk.shutdownCalls).toBe(4)
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
  failTransactionsWith: (error: unknown) => void
  failNextShutdownWith: (error: unknown) => void
  failNextUnsubscribeWith: (error: unknown) => void
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
    shutdownFailure: undefined as { error: unknown } | undefined,
    subscription: undefined as ((result: InstantSubscriptionResult) => void) | undefined,
    transactions: [] as unknown[],
    transactionFailure: undefined as unknown,
    unsubscribeFailure: undefined as { error: unknown } | undefined,
    unsubscribeCalls: 0,
  }
  const core = {
    shutdown: () => {
      state.shutdownCalls += 1
      const failure = state.shutdownFailure
      state.shutdownFailure = undefined
      if (failure !== undefined) {
        throw failure.error
      }
    },
    subscribeQuery: (_query: unknown, observer: (result: InstantSubscriptionResult) => void) => {
      state.subscription = observer
      return () => {
        state.unsubscribeCalls += 1
        const failure = state.unsubscribeFailure
        state.unsubscribeFailure = undefined
        if (failure !== undefined) {
          throw failure.error
        }
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
          if (state.transactionFailure !== undefined) {
            throw state.transactionFailure
          }
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
    failTransactionsWith(error: unknown) {
      state.transactionFailure = error
    },
    failNextShutdownWith(error: unknown) {
      state.shutdownFailure = { error }
    },
    failNextUnsubscribeWith(error: unknown) {
      state.unsubscribeFailure = { error }
    },
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
