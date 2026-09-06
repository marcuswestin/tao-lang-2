import TR from '@runtime/TR'
import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type DevDataHost,
  type DevDataSocket,
  devDataSocketUrl,
  DevProvider,
  fetchDevDataManifest,
  parseBundleHost,
} from '../@tao/data/providers/dev/Dev'
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

  Test('names a Dev stream by server, app key, and storage key, and reads the bundle host a device loaded from', () => {
    Expect(devDataSocketUrl('ws://192.168.1.20:4321/', 'Notes-0123abcd', 'My Notes'))
      .toBe('ws://192.168.1.20:4321/data?app=Notes-0123abcd&key=My%20Notes')
    Expect(parseBundleHost('http://192.168.1.20:8081/index.bundle?platform=ios')).toBe('192.168.1.20')
    Expect(parseBundleHost('http://[fe80::1]:8081/index.bundle')).toBe('[fe80::1]')
    Expect(parseBundleHost(undefined)).toBeUndefined()
    Expect(parseBundleHost('not a url')).toBeUndefined()
  })

  Test(
    'loads a Dev stream from its first snapshot, replays a missed one, and forwards peers and rejections',
    async () => {
      const wire = scriptedDevDataHost()
      const connection = DevProvider(() => wire.host).connect({
        configuration: {},
        schema: { entities: {}, name: 'DevTest' },
        storageKey: 'Notes',
      })

      const loading = connection.load() as Promise<string | undefined>
      await flushMicrotasks()
      Expect(wire.sockets).toHaveLength(1)
      Expect(wire.sockets[0]!.url).toBe('ws://dev.test:4321/data?app=Notes-0123abcd&key=Notes')
      wire.sockets[0]!.open()
      wire.sockets[0]!.receive({ revision: 1, snapshot: '{"first":true}', type: 'snapshot' })
      Expect(await loading).toBe('{"first":true}')

      // A peer's write between load and subscribe is kept for the subscriber.
      wire.sockets[0]!.receive({ revision: 2, snapshot: '{"missed":true}', type: 'snapshot' })
      const snapshots: Array<string | undefined> = []
      const errors: unknown[] = []
      const stop = connection.subscribe!({
        error: error => errors.push(error),
        snapshot: snapshot => snapshots.push(snapshot),
      })
      wire.sockets[0]!.receive({ revision: 3, snapshot: null, type: 'snapshot' })
      Expect(snapshots).toEqual(['{"missed":true}', undefined])

      const saving = connection.save('{"mine":true}')
      await flushMicrotasks()
      Expect(wire.sockets[0]!.sent).toEqual([{ seq: 1, snapshot: '{"mine":true}', type: 'save' }])
      wire.sockets[0]!.receive({ revision: 4, seq: 1, type: 'ack' })
      await saving

      const rejected = connection.save('{"bad":true}')
      await flushMicrotasks()
      wire.sockets[0]!.receive({ message: 'disk full', seq: 2, type: 'rejected' })
      await Expect(rejected).rejects.toThrow('disk full')

      // An open stream asks the server again rather than answering a load from memory.
      const reloading = connection.load() as Promise<string | undefined>
      await flushMicrotasks()
      Expect(wire.sockets[0]!.sent.at(-1)).toEqual({ seq: 3, type: 'load' })
      wire.sockets[0]!.receive({ revision: 4, snapshot: '{"current":true}', type: 'snapshot' })
      wire.sockets[0]!.receive({ revision: 4, seq: 3, type: 'ack' })
      Expect(await reloading).toBe('{"current":true}')
      Expect(snapshots).toEqual(['{"missed":true}', undefined])

      stop()
      connection.close?.()
      Expect(wire.sockets[0]!.closed).toBe(true)
      Expect(errors).toEqual([])
    },
  )

  Test("reports a lost Dev server as a sync failure and reconnects with the server's snapshot", async () => {
    const wire = scriptedDevDataHost()
    const connection = DevProvider(() => wire.host).connect({
      configuration: {},
      schema: { entities: {}, name: 'DevTest' },
      storageKey: 'Notes',
    })
    const loading = connection.load() as Promise<string | undefined>
    await flushMicrotasks()
    wire.sockets[0]!.open()
    wire.sockets[0]!.receive({ revision: 1, snapshot: null, type: 'snapshot' })
    await loading
    const snapshots: Array<string | undefined> = []
    const errors: Error[] = []
    connection.subscribe!({
      error: error => errors.push(error as Error),
      snapshot: snapshot => snapshots.push(snapshot),
    })

    wire.sockets[0]!.closeFromServer('server stopped')
    Expect(errors.map(error => error.message)).toEqual([
      'The Tao dev data server disconnected (server stopped); reconnecting.',
    ])
    // A write while the server is away dials once more, right now; the refused dial fails it honestly.
    const lost = connection.save('{"lost":true}')
    await flushMicrotasks()
    Expect(wire.sockets).toHaveLength(2)
    wire.sockets[1]!.closeFromServer('connection refused')
    await Expect(lost).rejects.toThrow('Could not reach the Tao dev data server')
    Expect(wire.timers.pending()).toBe(1)

    wire.timers.fire()
    await flushMicrotasks()
    Expect(wire.sockets).toHaveLength(3)
    wire.sockets[2]!.open()
    wire.sockets[2]!.receive({ revision: 1, snapshot: '{"peer":true}', type: 'snapshot' })
    Expect(snapshots).toEqual(['{"peer":true}'])
    connection.close?.()
    Expect(wire.timers.pending()).toBe(0)
  })

  Test('fails a Dev load plainly when the build carries no bootstrap, and dials nowhere', async () => {
    let bootstraps = 0
    const provider = DevProvider(() => ({
      bootstrap: async () => {
        bootstraps += 1
        return { kind: 'missing', missing: ['the Expo manifest carries no tao-dev-data-v1 bootstrap'] }
      },
      connect: () => Errors.throwUnexpected('must not dial'),
      timers: { clearTimeout: () => {}, setTimeout: () => 0 },
    }))
    const connection = provider.connect({
      configuration: {},
      schema: { entities: {}, name: 'DevTest' },
      storageKey: 'Notes',
    })

    await Expect(connection.load()).rejects.toThrow(
      'needs a running Tao dev server, but the Expo manifest carries no tao-dev-data-v1 bootstrap',
    )
    // Every attempt bootstraps again, so a dev server that appears later is found by the retry.
    await Expect(connection.load()).rejects.toThrow('needs a running Tao dev server')
    Expect(bootstraps).toBe(2)
  })

  Test('reads the dev data fact from the Expo dev server manifest and tolerates a server without one', async () => {
    const requests: Array<{ headers: Record<string, string>; url: string }> = []
    const answer = (body: unknown) => async (url: string, init: { headers: Record<string, string> }) => {
      requests.push({ headers: init.headers, url })
      return { json: async () => body }
    }

    const fact = { app: 'Notes-0123abcd', port: 4_321, protocol: 'tao-dev-data-v1' }
    // The Expo dev server's updates-style manifest nests the app config under extra.expoClient.
    const updatesManifest = { extra: { eas: {}, expoClient: { extra: { taoDevData: fact }, name: 'Tao Runtime' } } }
    Expect(await fetchDevDataManifest('http://192.168.1.20:8081/', answer(updatesManifest))).toEqual(fact)
    Expect(requests).toEqual([{ headers: { 'expo-platform': 'ios' }, url: 'http://192.168.1.20:8081/' }])
    Expect(await fetchDevDataManifest('http://localhost:8081', answer({ extra: { taoDevData: fact } }))).toEqual(fact)
    Expect(await fetchDevDataManifest('http://localhost:8081', answer({ extra: {} }))).toBeUndefined()
    Expect(await fetchDevDataManifest('http://localhost:8081', answer('<html>'))).toBeUndefined()
    Expect(await fetchDevDataManifest('http://localhost:8081', async () => Errors.throwHostEnvironment('refused')))
      .toBeUndefined()
  })
})

/** flushMicrotasks lets a bootstrap, a dial, and a send settle: each is a promise hop or two. */
async function flushMicrotasks(): Promise<void> {
  for (let hop = 0; hop < 6; hop += 1) {
    await Promise.resolve()
  }
}

type ScriptedSocket = DevDataSocket & {
  closeFromServer(reason: string): void
  closed: boolean
  open(): void
  receive(message: unknown): void
  sent: unknown[]
  url: string
}

/** scriptedDevDataHost emulates the dev data server end of the socket, one scripted socket per dial. */
function scriptedDevDataHost(): {
  host: DevDataHost
  sockets: ScriptedSocket[]
  timers: { fire(): void; pending(): number }
} {
  const sockets: ScriptedSocket[] = []
  const scheduled = new Map<number, () => void>()
  let nextHandle = 0
  const host: DevDataHost = {
    bootstrap: () => ({ app: 'Notes-0123abcd', kind: 'ready', serverUrl: 'ws://dev.test:4321' }),
    connect: url => {
      const socket: ScriptedSocket = {
        close: () => {
          socket.closed = true
        },
        closeFromServer: reason => {
          socket.closed = true
          socket.onclose?.(reason)
        },
        closed: false,
        open: () => socket.onopen?.(),
        receive: message => socket.onmessage?.(JSON.stringify(message)),
        send: text => {
          socket.sent.push(JSON.parse(text))
        },
        sent: [],
        url,
      }
      sockets.push(socket)
      return socket
    },
    timers: {
      clearTimeout: handle => {
        scheduled.delete(handle as number)
      },
      setTimeout: callback => {
        nextHandle += 1
        scheduled.set(nextHandle, callback)
        return nextHandle
      },
    },
  }
  return {
    host,
    sockets,
    timers: {
      fire: () => {
        const callbacks = [...scheduled.values()]
        scheduled.clear()
        for (const callback of callbacks) {
          callback()
        }
      },
      pending: () => scheduled.size,
    },
  }
}

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
