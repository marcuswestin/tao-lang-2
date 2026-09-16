import TR from '@runtime/TR'
import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import type { ICloudDocumentObserver, ICloudDocuments } from 'tao-icloud-native'
import type { CloudKitRecord, CloudKitZone, CloudKitZoneObserver, CloudKitZones } from 'tao-icloud-native/cloudkit'
import { CloudKitProvider, CloudKitSyncProvider } from '../@tao/data/providers/cloudkit/CloudKit'
import {
  type DevDataHost,
  type DevDataSocket,
  devDataSocketUrl,
  DevProvider,
  fetchDevDataManifest,
  parseBundleHost,
} from '../@tao/data/providers/dev/Dev'
import { ICloudProvider } from '../@tao/data/providers/icloud/ICloud'
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
    sdk.failTransactionsWith(`token=hidden\u001b[31m${'x'.repeat(400)}`)
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

  Test('publishes ICloud through the provider conformance contract', async () => {
    const cloud = fakeICloud()
    await TR.testProvider(
      () => ICloudProvider(() => cloud.documents),
      () => ICloudProvider(() => rejectingICloud()),
    )
  })

  Test('keeps one iCloud document per storage key and container and grants no reset', async () => {
    const cloud = fakeICloud()
    const provider = ICloudProvider(() => cloud.documents)
    const connection = provider.connect({
      configuration: { Container: ' iCloud.lang.tao.notes ' },
      schema: { entities: {}, name: 'ICloudTest' },
      storageKey: 'My Notes/Draft',
    })

    Expect(await connection.load()).toBeUndefined()
    await connection.save('{"snapshot":"saved"}')
    Expect(await connection.load()).toBe('{"snapshot":"saved"}')
    Expect([...cloud.store.keys()]).toHaveLength(1)
    Expect([...cloud.store.keys()][0]).toMatch(/^iCloud\.lang\.tao\.notes\/My%20Notes%2FDraft\.[0-9a-f]{8}\.json$/u)
    // Keys differing only by case must not share a document on a case-insensitive volume.
    await provider.connect({
      configuration: { Container: 'iCloud.lang.tao.notes' },
      schema: { entities: {}, name: 'ICloudTest' },
      storageKey: 'my notes/draft',
    }).save('{"snapshot":"other"}')
    Expect(new Set([...cloud.store.keys()].map(key => key.toLowerCase())).size).toBe(2)
    Expect(connection.reset).toBeUndefined()
    Expect(connection.referenceToken?.({ entity: 'Note', id: 'Note-1', schema: 'ICloudTest' })).toBe('Note-1')
    Expect(connection.resolveReference?.({ entity: 'Note', schema: 'ICloudTest', token: 'Note-1' })).toBe('Note-1')
  })

  Test('publishes remote document changes, never a missing document, and drops echoes of its own saves', async () => {
    const cloud = fakeICloud()
    const connection = ICloudProvider(() => cloud.documents).connect({
      configuration: {},
      schema: { entities: {}, name: 'ICloudTest' },
      storageKey: 'Notes',
    })
    await connection.load()
    const snapshots: Array<string | undefined> = []
    const errors: unknown[] = []
    const stop = connection.subscribe!({
      error: error => errors.push(error),
      snapshot: snapshot => snapshots.push(snapshot),
    })
    const watch = cloud.watchers[0]!
    Expect(watch.name).toMatch(/^\/Notes\.[0-9a-f]{8}\.json$/u)

    // A missing document is iCloud's bookkeeping mid-flight, never a request to empty the store.
    watch.observer.changed(undefined)
    watch.observer.changed('remote-1')
    // The metadata query reports our own write back; the runtime already holds that commit.
    await connection.save('local-1')
    watch.observer.changed('local-1')
    watch.observer.changed(undefined)
    watch.observer.changed('remote-2')
    // Another device can later restore bytes equal to our old write. Seeing remote-2 ended the
    // echo window, so this is a real remote transition rather than a forever-suppressed echo.
    watch.observer.changed('local-1')
    watch.observer.failed('iCloud is unavailable')
    stop()
    watch.observer.changed('after-stop')
    connection.close?.()

    Expect(snapshots).toEqual(['remote-1', 'remote-2', 'local-1'])
    Expect(errors).toHaveLength(1)
    Expect(errors[0]).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(Errors.messageOf(errors[0])).toBe('iCloud is unavailable')
    Expect(watch.stopped).toBe(1)
  })

  Test('defers watch events during back-to-back saves and re-reads the document once they settle', async () => {
    const cloud = fakeICloud()
    const connection = ICloudProvider(() => cloud.documents).connect({
      configuration: {},
      schema: { entities: {}, name: 'ICloudTest' },
      storageKey: 'Notes',
    })
    await connection.load()
    const snapshots: Array<string | undefined> = []
    connection.subscribe!({ error: () => undefined, snapshot: snapshot => snapshots.push(snapshot) })
    const watch = cloud.watchers[0]!

    // Two writes in flight: the watch reads the document between them and reports the earlier
    // contents after the later write has been recorded. Nothing publishes until both settle, and
    // the settling re-read finds this connection's own latest write.
    const first = connection.save('local-1')
    const second = connection.save('local-2')
    watch.observer.changed('local-1')
    await Promise.all([first, second])
    Expect(snapshots).toEqual([])

    // A remote write that lands right after ours is picked up by the settling re-read.
    cloud.afterWrite = () => cloud.store.set([...cloud.store.keys()][0]!, 'remote-after-3')
    const third = connection.save('local-3')
    watch.observer.changed('local-3')
    await third
    Expect(snapshots).toEqual(['remote-after-3'])
  })

  Test('validates ICloud config before touching the native module', () => {
    let nativeLoads = 0
    const provider = ICloudProvider(() => {
      nativeLoads += 1
      Errors.throwUnexpected('native module should not load')
    })

    Expect(() =>
      provider.connect({
        configuration: { Container: '  ' },
        schema: { entities: {}, name: 'ICloudConfigTest' },
        storageKey: 'Notes',
      })
    ).toThrow("ICloud datasource configuration 'Container' expects non-empty text when provided.")
    Expect(nativeLoads).toBe(0)
  })

  Test('publishes CloudKit through the sync provider conformance contract', async () => {
    const cloud = fakeCloudKit()
    await TR.Sync.testProvider(() => CloudKitSyncProvider(() => cloud.zones))
  })

  Test('stores one CloudKit record per row with stamped fields and relation identities', async () => {
    const cloud = fakeCloudKit()
    const connection = CloudKitProvider(() => cloud.zones, () => memoryKeyValueStorage()).connect({
      configuration: { Container: 'iCloud.lang.tao.notes' },
      schema: syncSchema,
      storageKey: 'Notes',
    })
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await connection.save(JSON.stringify({
      formatVersion: 1,
      nextId: 3,
      rows: {
        Note: [{ Id: 'Note-1', Pinned: true, Title: 'Hello' }],
        Paragraph: [{ Id: 'Paragraph-2', Note: 'Note-1', Text: 'Body' }],
      },
      schemaVersion: 1,
    }))
    await settle()

    // Every row is one `TaoRow` record with one JSON payload field, so the CloudKit schema is
    // deployed once and never follows a Tao data change.
    const records = [...cloud.zone('iCloud.lang.tao.notes', 'Notes').values()].map(entry => entry.record)
    type Payload = {
      deleted?: string
      entity: string
      fields: Record<string, { stamp: string; value: unknown }>
      row: { id: string; origin: string }
    }
    const payloadOf = (record: CloudKitRecord): Payload => JSON.parse(record.fields['payload'] as string) as Payload
    Expect(records.map(record => record.type)).toEqual(['TaoRow', 'TaoRow'])
    Expect(records.every(record => Object.keys(record.fields).join() === 'payload')).toBe(true)
    const note = records.find(record => payloadOf(record).entity === 'Note')!
    const paragraph = records.find(record => payloadOf(record).entity === 'Paragraph')!
    Expect(note.name).toMatch(/^[0-9a-f]{8}:Note:Note-1$/u)
    Expect(payloadOf(note).fields['Title']?.value).toBe('Hello')
    Expect(payloadOf(note).fields['Pinned']?.value).toBe(true)
    Expect(payloadOf(note).fields['Title']?.stamp).toMatch(/^[0-9a-f]{16}[0-9a-f]{8}$/u)
    Expect(payloadOf(paragraph).fields['Note']?.value).toEqual({ id: 'Note-1', origin: payloadOf(note).row.origin })
    Expect(payloadOf(note).deleted).toBeUndefined()

    // A delete keeps the record and stamps a tombstone on it, so no relaunch can resurrect the row.
    await connection.save(JSON.stringify({
      formatVersion: 1,
      nextId: 3,
      rows: { Note: [], Paragraph: [] },
      schemaVersion: 1,
    }))
    await settle()
    const deleted = payloadOf(cloud.zone('iCloud.lang.tao.notes', 'Notes').get(note.name)!.record)
    Expect(deleted.fields['Title']?.value).toBe('Hello')
    Expect(deleted.deleted).toMatch(/^[0-9a-f]{16}[0-9a-f]{8}$/u)
  })

  Test('delivers text and cleared cross-store reference values from CloudKit', async () => {
    let zoneObserver: CloudKitZoneObserver | undefined
    const connection = CloudKitSyncProvider(() => () => ({
      close: () => undefined,
      fetch: async () => undefined,
      send: async () => undefined,
      subscribe: observer => {
        zoneObserver = observer
        return () => undefined
      },
    })).connect({
      configuration: {},
      origin: 'aaaaaaaa',
      schema: {
        entities: {
          Bookmark: {
            collection: 'Bookmarks',
            fields: {
              Story: {
                kind: 'reference',
                referenceField: 'Slug',
                relation: 'Story',
                store: 'Stories',
              },
            },
          },
        },
        name: 'Bookmarks',
      },
      storageKey: 'Bookmarks',
    })
    const received: TR.ChangeSet[] = []
    connection.subscribe({
      accepted: () => undefined,
      failed: () => undefined,
      online: () => undefined,
      remote: changeSet => {
        received.push(changeSet)
      },
    })
    const stamp = TR.Sync.stampAt(1_000, 'cloudkit')
    const record = (id: string, value: string | null): CloudKitRecord => ({
      fields: {
        payload: JSON.stringify({
          entity: 'Bookmark',
          fields: { Story: { stamp, value } },
          row: { id, origin: 'bbbbbbbb' },
        }),
      },
      name: `bbbbbbbb:Bookmark:${id}`,
      type: 'TaoRow',
    })
    zoneObserver!.fetched([record('Bookmark-1', 'show-hn'), record('Bookmark-2', null)], [], async () => undefined)
    await settle()

    const values = received.flatMap(changeSet => changeSet.ops)
      .flatMap(op => op.kind === 'upsert' ? [op.fields['Story']?.value] : [])
    Expect(values).toEqual(['show-hn', null])
  })

  Test('merges a CloudKit server conflict fieldwise and converges both devices', async () => {
    const cloud = fakeCloudKit()
    let clock = 5_000
    const replica = async (origin: string): Promise<{ connection: TR.DataConnection; snapshots: string[] }> => {
      const connection = TR.Sync.overSnapshot(
        CloudKitSyncProvider(() => cloud.zones),
        { configuration: {}, schema: syncSchema, storageKey: 'Notes' },
        { now: () => clock++, origin, storage: memoryKeyValueStorage() },
      )
      const snapshots: string[] = []
      await connection.load()
      connection.subscribe!({ error: () => undefined, snapshot: value => snapshots.push(value ?? '') })
      await settle()
      return { connection, snapshots }
    }
    const a = await replica('aaaaaaaa')
    const b = await replica('bbbbbbbb')
    const snapshot = (rows: Record<string, unknown[]>): string =>
      JSON.stringify({ formatVersion: 1, nextId: 2, rows: { Paragraph: [], ...rows }, schemaVersion: 1 })
    const rowsOf = (serialized: string): { Note: Array<Record<string, unknown>> } =>
      (JSON.parse(serialized) as { rows: { Note: Array<Record<string, unknown>> } }).rows

    await a.connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Hello' }] }))
    await settle()
    Expect(rowsOf(b.snapshots.at(-1)!).Note).toEqual([{ Id: 'Note-1~aaaaaaaa', Pinned: false, Title: 'Hello' }])

    // B falls offline; A retitles; B pins. B's save reaches the server with a stale record and
    // comes back as a conflict, which merges fieldwise: A's title, B's pin.
    cloud.setOnline(1, false)
    await a.connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'From A' }] }))
    await b.connection.save(snapshot({ Note: [{ Id: 'Note-1~aaaaaaaa', Pinned: true, Title: 'Hello' }] }))
    await settle()
    cloud.setOnline(1, true)
    await settle()

    Expect(cloud.conflicts).toBe(1)
    // Every fetched batch was acknowledged once the fold had persisted it.
    Expect(cloud.acknowledged).toBeGreaterThan(0)
    Expect(cloud.unacknowledged).toBe(0)
    Expect(rowsOf(a.snapshots.at(-1)!).Note).toEqual([{ Id: 'Note-1', Pinned: true, Title: 'From A' }])
    Expect(rowsOf((await b.connection.load())!).Note).toEqual([{
      Id: 'Note-1~aaaaaaaa',
      Pinned: true,
      Title: 'From A',
    }])
  })

  Test('keeps a change pending when CloudKit returns an unreadable conflict', async () => {
    let zoneObserver: CloudKitZoneObserver | undefined
    const sent: CloudKitRecord[][] = []
    const connection = CloudKitSyncProvider(() => () => ({
      close: () => undefined,
      fetch: async () => undefined,
      send: async records => {
        sent.push([...records])
      },
      subscribe: observer => {
        zoneObserver = observer
        return () => undefined
      },
    })).connect({ configuration: {}, origin: 'aaaaaaaa', schema: syncSchema, storageKey: 'Notes' })
    const accepted: string[] = []
    const failures: unknown[] = []
    connection.subscribe({
      accepted: id => accepted.push(id),
      failed: error => failures.push(error),
      online: () => undefined,
      remote: () => undefined,
    })
    const stamp = TR.Sync.stampAt(1_000, 'aaaaaaaa')
    await connection.push({
      id: stamp,
      ops: [{
        entity: 'Note',
        fields: {
          Pinned: { stamp, value: false },
          Title: { stamp, value: 'Pending' },
        },
        kind: 'upsert',
        row: { id: 'Note-1', origin: 'aaaaaaaa' },
      }],
      origin: 'aaaaaaaa',
      stamp,
    })
    const name = sent[0]![0]!.name
    zoneObserver!.sent([], [{
      name,
      server: { fields: { payload: 'not-json' }, name, type: 'TaoRow' },
    }], [])

    Expect(accepted).toEqual([])
    Expect(failures).toHaveLength(1)
    Expect(failures[0]).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(Errors.messageOf(failures[0])).toContain('unreadable conflict')
  })

  Test('validates CloudKit config before touching the native module', () => {
    let nativeLoads = 0
    const provider = CloudKitProvider(() => {
      nativeLoads += 1
      Errors.throwUnexpected('native module should not load')
    }, () => memoryKeyValueStorage())

    Expect(() =>
      provider.connect({
        configuration: { Container: '' },
        schema: syncSchema,
        storageKey: 'Notes',
      })
    ).toThrow("CloudKit datasource configuration 'Container' expects non-empty text when provided.")
    Expect(nativeLoads).toBe(0)
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
    Expect(devDataSocketUrl('ws://192.168.1.20:4321/', 'Notes-0123abcd', 'My Notes', 'secret'))
      .toBe('ws://192.168.1.20:4321/data?app=Notes-0123abcd&key=My%20Notes&capability=secret')
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
      Expect(wire.sockets[0]!.url).toBe(
        'ws://dev.test:4321/data?app=Notes-0123abcd&key=Notes&capability='
          + 'test_capability_0123456789abcdef0123456789abcdef',
      )
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
      Expect(wire.sockets[0]!.sent).toEqual([{
        expectedRevision: 3,
        seq: 1,
        snapshot: '{"mine":true}',
        type: 'save',
      }])
      wire.sockets[0]!.receive({ revision: 4, snapshot: '{"mine":true}', type: 'snapshot' })
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
      Expect(snapshots).toEqual(['{"missed":true}', undefined, '{"mine":true}'])

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

    const fact = {
      app: 'Notes-0123abcd',
      capability: 'test_capability_0123456789abcdef0123456789abcdef',
      port: 4_321,
      protocol: 'tao-dev-data-v1',
    }
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
    bootstrap: () => ({
      app: 'Notes-0123abcd',
      capability: 'test_capability_0123456789abcdef0123456789abcdef',
      kind: 'ready',
      serverUrl: 'ws://dev.test:4321',
    }),
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
  failTransactionsWith: (error: unknown) => void
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
    transactionFailure: undefined as unknown,
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

type FakeICloudWatch = { name: string; observer: ICloudDocumentObserver; stopped: number }

/**
 * fakeICloud emulates the native document boundary: one store keyed by container and document.
 * `afterWrite` lets a test land a remote write immediately after this connection's own.
 */
function fakeICloud(): {
  afterWrite?: (contents: string) => void
  documents: ICloudDocuments
  store: Map<string, string>
  watchers: FakeICloudWatch[]
} {
  const store = new Map<string, string>()
  const watchers: FakeICloudWatch[] = []
  const key = (container: string | undefined, name: string): string => `${container ?? ''}/${name}`
  const cloud: ReturnType<typeof fakeICloud> = {
    documents: {
      read: async (container, name) => store.get(key(container, name)),
      watch: (container, name, observer) => {
        const watch: FakeICloudWatch = { name: key(container, name), observer, stopped: 0 }
        watchers.push(watch)
        return () => {
          watch.stopped += 1
        }
      },
      write: async (container, name, contents) => {
        store.set(key(container, name), contents)
        cloud.afterWrite?.(contents)
      },
    },
    store,
    watchers,
  }
  return cloud
}

function rejectingICloud(): ICloudDocuments {
  return {
    read: async () => undefined,
    watch: () => () => undefined,
    write: async () => {
      Errors.throwHostEnvironment('iCloud unavailable')
    },
  }
}

const syncSchema: TR.DataSchemaDefinition = {
  entities: {
    Note: {
      collection: 'Notes',
      fields: {
        Pinned: { kind: 'boolean' },
        Title: { kind: 'text' },
      },
    },
    Paragraph: {
      collection: 'Paragraphs',
      fields: {
        Note: { kind: 'relation', relation: 'Note' },
        Text: { kind: 'text' },
      },
    },
  },
  name: 'CloudKitTest',
}

function memoryKeyValueStorage(): {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
} {
  const values = new Map<string, string>()
  return {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value)
    },
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
}

type FakeCloudKitEntry = { record: CloudKitRecord; version: number }
type FakeCloudKitSession = {
  known: Map<string, number>
  observer?: CloudKitZoneObserver
  online: boolean
  /** outbox holds queued sends with the record versions known when they were queued, as the sync engine's pending records do. */
  outbox: Array<{ known: Map<string, number>; records: readonly CloudKitRecord[] }>
  zone: Map<string, FakeCloudKitEntry>
}

/**
 * fakeCloudKit emulates CloudKit's private database for the zone boundary: one record store per
 * container and zone shared by every session opened on it, versioned records so a save over a
 * stale copy comes back as a conflict carrying the server's record, and push-style delivery of
 * every accepted change to the other online sessions. As `CKSyncEngine` does, an offline session
 * takes sends into its own queue and plays them against the server once it is back online, after
 * fetching what it missed. As the server does, it stores numbers as doubles, so a boolean that
 * was not encoded deliberately would not survive; and every fetched batch must be acknowledged.
 */
function fakeCloudKit(): {
  acknowledged: number
  conflicts: number
  sessions: FakeCloudKitSession[]
  setOnline(index: number, online: boolean): void
  unacknowledged: number
  zone(container: string | undefined, name: string): Map<string, FakeCloudKitEntry>
  zones: CloudKitZones
} {
  const stores = new Map<string, Map<string, FakeCloudKitEntry>>()
  const sessions: FakeCloudKitSession[] = []
  const state = { acknowledged: 0, conflicts: 0, delivered: 0 }
  const zoneOf = (container: string | undefined, name: string): Map<string, FakeCloudKitEntry> => {
    const key = `${container ?? ''}/${name}`
    const existing = stores.get(key)
    if (existing) {
      return existing
    }
    const created = new Map<string, FakeCloudKitEntry>()
    stores.set(key, created)
    return created
  }
  const stored = (record: CloudKitRecord): CloudKitRecord => ({
    ...record,
    fields: Object.fromEntries(
      Object.entries(record.fields).map((
        [key, value],
      ) => [key, typeof value === 'number' ? Number(value) : String(value)]),
    ),
  })
  const fetched = (session: FakeCloudKitSession, modifications: CloudKitRecord[]): void => {
    if (modifications.length === 0 || session.observer === undefined) {
      return
    }
    state.delivered += 1
    session.observer.fetched(modifications, [], async () => {
      state.acknowledged += 1
    })
  }
  const catchUp = (session: FakeCloudKitSession): void => {
    const modifications: CloudKitRecord[] = []
    for (const [name, entry] of session.zone) {
      if (session.known.get(name) !== entry.version) {
        session.known.set(name, entry.version)
        modifications.push(entry.record)
      }
    }
    fetched(session, modifications)
  }
  const process = (
    session: FakeCloudKitSession,
    records: readonly CloudKitRecord[],
    knownAtQueue: Map<string, number> = session.known,
  ): void => {
    const savedRecords: CloudKitRecord[] = []
    const conflicts: Array<{ name: string; server: CloudKitRecord }> = []
    for (const sent of records) {
      const record = stored(sent)
      const existing = session.zone.get(record.name)
      if (existing !== undefined && knownAtQueue.get(record.name) !== existing.version) {
        state.conflicts += 1
        session.known.set(record.name, existing.version)
        conflicts.push({ name: record.name, server: existing.record })
        continue
      }
      const version = (existing?.version ?? 0) + 1
      session.zone.set(record.name, { record, version })
      session.known.set(record.name, version)
      savedRecords.push(record)
      for (const other of sessions) {
        if (other !== session && other.zone === session.zone && other.online) {
          other.known.set(record.name, version)
          fetched(other, [record])
        }
      }
    }
    session.observer?.sent(savedRecords, conflicts, [])
  }
  const zones: CloudKitZones = (container, name) => {
    const session: FakeCloudKitSession = {
      known: new Map(),
      online: true,
      outbox: [],
      zone: zoneOf(container, name),
    }
    sessions.push(session)
    const zone: CloudKitZone = {
      close: () => {
        session.observer = undefined
      },
      fetch: async () => {
        if (session.online) {
          catchUp(session)
        }
      },
      send: async records => {
        if (session.online) {
          process(session, records)
        } else {
          session.outbox.push({ known: new Map(session.known), records })
        }
      },
      subscribe: observer => {
        session.observer = observer
        return () => {
          if (session.observer === observer) {
            session.observer = undefined
          }
        }
      },
    }
    return zone
  }
  return {
    get acknowledged() {
      return state.acknowledged
    },
    get conflicts() {
      return state.conflicts
    },
    sessions,
    setOnline: (index, online) => {
      const session = sessions[index]!
      session.online = online
      if (online) {
        catchUp(session)
        const queued = session.outbox.splice(0)
        for (const entry of queued) {
          process(session, entry.records, entry.known)
        }
      }
    },
    get unacknowledged() {
      return state.delivered - state.acknowledged
    },
    zone: zoneOf,
    zones,
  }
}
