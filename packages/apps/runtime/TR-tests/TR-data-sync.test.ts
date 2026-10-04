import { Deferred, Describe, Expect, Test } from '@shared/test'
import type { TaoDataConnection, TaoDataSchemaDefinition, TaoKeyValueStorage } from '../TaoRuntime-src/TR-data'
import { memoryKeyValueStorage } from '../TaoRuntime-src/TR-data-provider'
import {
  createMemorySyncAuthority,
  snapshotConnectionOverSync,
  stampAt,
  type TaoChangeSet,
  type TaoSyncObserver,
  type TaoSyncProvider,
  testSyncProvider,
} from '../TaoRuntime-src/TR-data-sync'
import { HostEnvironmentError } from '../TaoRuntime-src/TR-errors'

const definition: TaoDataSchemaDefinition = {
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
  name: 'SyncTest',
}

type Rows = {
  Note: Array<{ Id: string; Pinned: boolean; Title: string }>
  Paragraph: Array<{ Id: string; Note: string; Text: string }>
}

type Replica = {
  connection: TaoDataConnection
  provider: ReturnType<ReturnType<typeof createMemorySyncAuthority>['provider']>
  snapshots: string[]
  storage: TaoKeyValueStorage & { values: Map<string, string> }
}

Describe('granular sync over the snapshot bridge', () => {
  Test('passes the sync provider conformance suite over the memory authority', async () => {
    const authority = createMemorySyncAuthority()
    await testSyncProvider(() => authority.provider())
  })

  Test('merges concurrent edits to different fields and resolves a same-field race by stamp', async () => {
    const world = createWorld()
    const a = await world.replica('aaaaaaaa')
    const b = await world.replica('bbbbbbbb')
    await a.connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Hello' }], Paragraph: [] }))
    await settle()
    Expect(rows(latest(b.snapshots)).Note).toEqual([{ Id: 'Note-1~aaaaaaaa', Pinned: false, Title: 'Hello' }])

    // Both replicas go offline and edit the same row: A retitles, B (later on the clock) pins and
    // retitles. On reconnect the title is B's and the pin survives, whichever order the authority
    // hands the change-sets out.
    a.provider.setOnline(false)
    b.provider.setOnline(false)
    await a.connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'From A' }], Paragraph: [] }))
    await b.connection.save(
      snapshot({ Note: [{ Id: 'Note-1~aaaaaaaa', Pinned: true, Title: 'From B' }], Paragraph: [] }),
    )
    b.provider.setOnline(true)
    await settle()
    a.provider.setOnline(true)
    await settle()

    Expect(rows(latest(a.snapshots)).Note).toEqual([{ Id: 'Note-1', Pinned: true, Title: 'From B' }])
    // B's own edits won every field, so nothing republishes there; its projection says the same.
    Expect((await current(b)).Note).toEqual([{ Id: 'Note-1~aaaaaaaa', Pinned: true, Title: 'From B' }])
    Expect(world.authority.history.map(changeSet => changeSet.origin)).toEqual(['aaaaaaaa', 'bbbbbbbb', 'aaaaaaaa'])
  })

  Test('keeps offline change-sets queued across a relaunch and pushes them once online', async () => {
    const world = createWorld()
    const a = await world.replica('aaaaaaaa', { online: false })
    await a.connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Offline' }], Paragraph: [] }))
    Expect(world.authority.history).toHaveLength(0)
    Expect(JSON.parse(a.storage.values.get('tao-sync:["default","Notes"]')!) as { pending: unknown[] })
      .toMatchObject({
        pending: [{ origin: 'aaaaaaaa' }],
      })

    a.connection.close?.()
    const relaunched = await world.replica('aaaaaaaa', { storage: a.storage })
    await settle()
    Expect(world.authority.history).toHaveLength(1)
    Expect(JSON.parse(relaunched.storage.values.get('tao-sync:["default","Notes"]')!) as { pending: unknown[] })
      .toMatchObject({
        pending: [],
      })
    const b = await world.replica('bbbbbbbb')
    await settle()
    Expect(rows(latest(b.snapshots)).Note).toEqual([{ Id: 'Note-1~aaaaaaaa', Pinned: false, Title: 'Offline' }])
  })

  Test('keeps a deleted parent and child deleted under a later offline edit', async () => {
    const world = createWorld()
    const a = await world.replica('aaaaaaaa')
    const b = await world.replica('bbbbbbbb', { online: false })
    await a.connection.save(snapshot({
      Note: [{ Id: 'Note-1', Pinned: false, Title: 'Parent' }],
      Paragraph: [{ Id: 'Paragraph-1', Note: 'Note-1', Text: 'Child' }],
    }))
    await settle()
    // The authority delivers in history order, so B sees the note and paragraph together; the
    // reordering transport below is where the visibility fixpoint is proven.
    b.provider.setOnline(true)
    await settle()
    Expect(rows(latest(b.snapshots)).Paragraph).toEqual([{
      Id: 'Paragraph-1~aaaaaaaa',
      Note: 'Note-1~aaaaaaaa',
      Text: 'Child',
    }])

    // A deletes the note (and its paragraph) while B, offline, edits the note's title.
    b.provider.setOnline(false)
    await b.connection.save(snapshot({
      Note: [{ Id: 'Note-1~aaaaaaaa', Pinned: false, Title: 'Edited while deleted' }],
      Paragraph: [{ Id: 'Paragraph-1~aaaaaaaa', Note: 'Note-1~aaaaaaaa', Text: 'Child' }],
    }))
    await a.connection.save(snapshot({ Note: [], Paragraph: [] }))
    await settle()
    b.provider.setOnline(true)
    await settle()

    // B's later title edit merged into A's tombstone without reviving the row, so A's projection
    // did not change and A republished nothing; B received the delete and republished.
    Expect((await current(a)).Note).toEqual([])
    Expect(rows(latest(b.snapshots)).Note).toEqual([])
    Expect(rows(latest(b.snapshots)).Paragraph).toEqual([])
  })

  Test('folds a child delivered before its parent and shows both once the parent lands', async () => {
    const parent: TaoChangeSet = {
      id: '0000000000100000cccccccc',
      ops: [{
        entity: 'Note',
        fields: {
          Pinned: { stamp: '0000000000100000cccccccc', value: false },
          Title: { stamp: '0000000000100000cccccccc', value: 'Parent' },
        },
        kind: 'upsert',
        row: { id: 'Note-1', origin: 'cccccccc' },
      }],
      origin: 'cccccccc',
      stamp: '0000000000100000cccccccc',
    }
    const child: TaoChangeSet = {
      id: '0000000000110000cccccccc',
      ops: [{
        entity: 'Paragraph',
        fields: {
          Note: { stamp: '0000000000110000cccccccc', value: { id: 'Note-1', origin: 'cccccccc' } },
          Text: { stamp: '0000000000110000cccccccc', value: 'Child' },
        },
        kind: 'upsert',
        row: { id: 'Paragraph-1', origin: 'cccccccc' },
      }],
      origin: 'cccccccc',
      stamp: '0000000000110000cccccccc',
    }
    const reordering: TaoSyncProvider = {
      connect: () => ({
        push: () => undefined,
        subscribe: observer => {
          observer.remote(child)
          observer.remote(parent)
          return () => undefined
        },
      }),
    }
    const snapshots: string[] = []
    const connection = snapshotConnectionOverSync(
      reordering,
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', storage: memoryKeyValueStorage() },
    )
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: value => snapshots.push(value ?? '') })
    await settle()

    // The child alone projects nothing new (its parent is unknown), so only one snapshot follows.
    Expect(snapshots).toHaveLength(1)
    Expect(rows(latest(snapshots))).toEqual({
      Note: [{ Id: 'Note-1~cccccccc', Pinned: false, Title: 'Parent' }],
      Paragraph: [{ Id: 'Paragraph-1~cccccccc', Note: 'Note-1~cccccccc', Text: 'Child' }],
    })
  })

  Test('diffs a save against the rows the store held, so a remote row the save predates is not deleted', async () => {
    let remote: TaoSyncObserver | undefined
    const pushed: TaoChangeSet[] = []
    const provider: TaoSyncProvider = {
      connect: () => ({
        push: changeSet => {
          pushed.push(changeSet)
        },
        subscribe: observer => {
          remote = observer
          return () => undefined
        },
      }),
    }
    let clock = 9_000
    const snapshots: string[] = []
    const connection = snapshotConnectionOverSync(
      provider,
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { now: () => clock++, origin: 'aaaaaaaa', storage: memoryKeyValueStorage() },
    )
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: value => snapshots.push(value ?? '') })
    await connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Mine' }], Paragraph: [] }))
    await settle()

    // B's row arrives, and before the bridge has folded it the store commits a snapshot that
    // predates it — exactly what the store does when it buffers a publish behind a pending save.
    const theirs: TaoChangeSet = {
      id: '0000000000200000bbbbbbbb',
      ops: [{
        entity: 'Note',
        fields: {
          Pinned: { stamp: '0000000000200000bbbbbbbb', value: false },
          Title: { stamp: '0000000000200000bbbbbbbb', value: 'Theirs' },
        },
        kind: 'upsert',
        row: { id: 'Note-1', origin: 'bbbbbbbb' },
      }],
      origin: 'bbbbbbbb',
      stamp: '0000000000200000bbbbbbbb',
    }
    const folded = remote!.remote(theirs)
    const stale = connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: true, Title: 'Mine' }], Paragraph: [] }))
    await Promise.all([folded, stale])
    await settle()

    Expect(pushed.flatMap(changeSet => changeSet.ops.map(op => op.kind))).not.toContain('delete')
    const expected = [
      { Id: 'Note-1', Pinned: true, Title: 'Mine' },
      { Id: 'Note-1~bbbbbbbb', Pinned: false, Title: 'Theirs' },
    ]
    // The bridge handed the remote row back after the save that predated it, and holds both.
    Expect(rows(latest(snapshots)).Note).toEqual(expected)
    Expect(rows((await connection.load()) ?? '').Note).toEqual(expected)
  })

  Test('replays an explicitly submitted same-value field over a buffered remote change', async () => {
    let remote: TaoSyncObserver | undefined
    const pushed: TaoChangeSet[] = []
    const clocks = [10_000, 20_000]
    const snapshots: string[] = []
    const connection = snapshotConnectionOverSync(
      {
        connect: () => ({
          push: changeSet => {
            pushed.push(changeSet)
          },
          subscribe: observer => {
            remote = observer
            return () => undefined
          },
        }),
      },
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { now: () => clocks.shift()!, origin: 'aaaaaaaa', storage: memoryKeyValueStorage() },
    )
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: value => snapshots.push(value ?? '') })
    const mine = snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Mine' }], Paragraph: [] })
    await connection.save(mine)
    await settle()

    const theirs: TaoChangeSet = {
      id: stampAt(15_000, 'bbbbbbbb'),
      ops: [{
        entity: 'Note',
        fields: { Title: { stamp: stampAt(15_000, 'bbbbbbbb'), value: 'Theirs' } },
        kind: 'upsert',
        row: { id: 'Note-1', origin: 'aaaaaaaa' },
      }],
      origin: 'bbbbbbbb',
      stamp: stampAt(15_000, 'bbbbbbbb'),
    }
    const folded = remote!.remote(theirs)
    const saved = connection.save(mine, [{ entity: 'Note', fields: ['Title'], id: 'Note-1' }])
    await Promise.all([folded, saved])
    await settle()

    const replay = pushed.at(-1)!
    Expect(replay.ops).toContainEqual(Expect['objectContaining']({
      entity: 'Note',
      fields: { Title: Expect['objectContaining']({ value: 'Mine' }) },
      kind: 'upsert',
    }))
    Expect(rows((await connection.load()) ?? '').Note).toEqual([{ Id: 'Note-1', Pinned: false, Title: 'Mine' }])
  })

  Test('rolls back a remote fold whose checkpoint failed, so the same batch can be retried', async () => {
    let remote: TaoSyncObserver | undefined
    let rejectPersist = true
    const values = new Map<string, string>()
    const storage: TaoKeyValueStorage = {
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => {
        if (rejectPersist) {
          throw new HostEnvironmentError('checkpoint unavailable')
        }
        values.set(key, value)
      },
    }
    const connection = snapshotConnectionOverSync(
      {
        connect: () => ({
          push: () => undefined,
          subscribe: observer => {
            remote = observer
            return () => undefined
          },
        }),
      },
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', storage },
    )
    const snapshots: string[] = []
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: value => snapshots.push(value ?? '') })
    const changeSet: TaoChangeSet = {
      id: '0000000000200000bbbbbbbb',
      ops: [{
        entity: 'Note',
        fields: {
          Pinned: { stamp: '0000000000200000bbbbbbbb', value: false },
          Title: { stamp: '0000000000200000bbbbbbbb', value: 'Retry me' },
        },
        kind: 'upsert',
        row: { id: 'Note-1', origin: 'bbbbbbbb' },
      }],
      origin: 'bbbbbbbb',
      stamp: '0000000000200000bbbbbbbb',
    }

    await Expect(Promise.resolve(remote!.remote(changeSet))).rejects.toThrow('checkpoint unavailable')
    rejectPersist = false
    await remote!.remote(changeSet)

    Expect(rows(latest(snapshots)).Note).toEqual([{
      Id: 'Note-1~bbbbbbbb',
      Pinned: false,
      Title: 'Retry me',
    }])
  })

  // REMOVAL CANDIDATE: Mixed write-status recovery also queues a later commit; deleting this loses its explicit transport-admission assertion.
  Test('continues with later pending commits when one transport push is rejected', async () => {
    const attempts: string[] = []
    let refused: string | undefined
    const connection = snapshotConnectionOverSync(
      {
        connect: () => ({
          push: changeSet => {
            attempts.push(changeSet.id)
            refused ??= changeSet.id
            if (changeSet.id === refused) {
              throw new HostEnvironmentError('record refused')
            }
          },
          subscribe: () => () => undefined,
        }),
      },
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      {
        now: (() => {
          let now = 10_000
          return () => now++
        })(),
        origin: 'aaaaaaaa',
        storage: memoryKeyValueStorage(),
      },
    )
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'First' }], Paragraph: [] }))
    await connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: true, Title: 'Second' }], Paragraph: [] }))
    await settle()

    Expect(new Set(attempts).size).toBe(2)
    Expect(attempts.filter(id => id === refused).length).toBeGreaterThan(1)
  })

  Test('persists failed change-sets, projects mixed entity status, and retries the recorded payload', async () => {
    let observer: TaoSyncObserver | undefined
    let acceptFailed = false
    let failedId: string | undefined
    const attempts: TaoChangeSet[] = []
    const storage = memoryKeyValueStorage()
    const provider: TaoSyncProvider = {
      connect: () => ({
        push: changeSet => {
          attempts.push(changeSet)
          failedId ??= changeSet.id
          if (changeSet.id !== failedId) {
            return
          }
          if (!acceptFailed) {
            throw new HostEnvironmentError('offline')
          }
          observer?.accepted(changeSet.id)
        },
        subscribe: next => {
          observer = next
          return () => undefined
        },
      }),
    }
    const connect = () =>
      snapshotConnectionOverSync(
        provider,
        { configuration: {}, schema: definition, storageKey: 'Notes' },
        { origin: 'aaaaaaaa', storage },
      )
    const first = connect()
    await first.load()
    first.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await first.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'First' }], Paragraph: [] }))
    await first.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: true, Title: 'Second' }], Paragraph: [] }))
    await settle()

    const failedPayload = attempts[0]!
    const initialStatus = first.writes.status('Note', 'Note-1')
    Expect(initialStatus).toMatchObject({ failed: 1, queued: 1 })
    Expect(initialStatus.records[0]).toEqual({ id: failedPayload.id, message: 'offline' })
    Expect(JSON.parse(storage.values.get('tao-sync:["default","Notes"]')!) as { failures: unknown[] })
      .toMatchObject({ failures: [{ changeSetId: failedPayload.id, message: 'offline' }] })

    first.close?.()
    const relaunched = connect()
    await relaunched.load()
    // Check before transport startup can fail the same record again: this proves the failure itself restored.
    Expect(relaunched.writes.status('Note', 'Note-1')).toMatchObject({ failed: 1, queued: 1 })
    relaunched.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await settle()
    Expect(relaunched.writes.status('Note', 'Note-1')).toMatchObject({ failed: 1, queued: 1 })

    acceptFailed = true
    const retryStart = attempts.length
    relaunched.writes.retry('Note', 'Note-1')
    await settle()

    Expect(attempts.slice(retryStart).find(changeSet => changeSet.id === failedPayload.id)).toEqual(failedPayload)
    // Only the acknowledged record clears; the later unacknowledged mutation remains unresolved.
    Expect(relaunched.writes.status('Note', 'Note-1')).toMatchObject({ failed: 0, queued: 1 })
  })

  Test('does not expose a queued retry or drop an acknowledgement when checkpoint persistence fails', async () => {
    let observer: TaoSyncObserver | undefined
    let rejectCheckpoint = false
    const attempts: TaoChangeSet[] = []
    const values = new Map<string, string>()
    const storage: TaoKeyValueStorage = {
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => {
        if (rejectCheckpoint) {
          throw new HostEnvironmentError('checkpoint unavailable')
        }
        values.set(key, value)
      },
    }
    const connection = snapshotConnectionOverSync(
      {
        connect: () => ({
          push: changeSet => {
            attempts.push(changeSet)
            throw new HostEnvironmentError('offline')
          },
          subscribe: next => {
            observer = next
            return () => undefined
          },
        }),
      },
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', storage },
    )
    const errors: unknown[] = []
    const statuses: Array<{ failed: number; queued: number }> = []
    await connection.load()
    connection.subscribe!({ error: error => errors.push(error), snapshot: () => undefined })
    const stop = connection.writes.subscribe(() => {
      const status = connection.writes.status('Note', 'Note-1')
      statuses.push({ failed: status.failed, queued: status.queued })
    })
    await connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'First' }], Paragraph: [] }))
    await settle()
    const recorded = attempts[0]!
    Expect(connection.writes.status('Note', 'Note-1')).toMatchObject({ failed: 1, queued: 0 })

    rejectCheckpoint = true
    const beforeRetry = attempts.length
    connection.writes.retry('Note', 'Note-1')
    await settle()
    Expect(attempts).toHaveLength(beforeRetry)
    Expect(connection.writes.status('Note', 'Note-1')).toMatchObject({ failed: 1, queued: 0 })
    Expect(statuses.at(-1)).toEqual({ failed: 1, queued: 0 })

    // An acknowledgement is also rolled back until its checkpoint write succeeds.
    observer!.accepted(recorded.id)
    await settle()
    Expect(connection.writes.status('Note', 'Note-1')).toMatchObject({ failed: 1, queued: 0 })
    Expect(errors.map(error => error instanceof Error ? error.message : String(error))).toContain(
      'checkpoint unavailable',
    )

    rejectCheckpoint = false
    connection.writes.retry('Note', 'Note-1')
    await settle()
    Expect(attempts.slice(beforeRetry).filter(changeSet => changeSet.id === recorded.id)).toHaveLength(1)
    Expect(statuses).toContainEqual({ failed: 0, queued: 1 })
    stop()
  })

  Test('does not expose a queued write until its checkpoint persists', async () => {
    const values = new Map<string, string>()
    const entered = Deferred<void>()
    const release = Deferred<void>()
    let delayWrite = false
    const storage: TaoKeyValueStorage = {
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => {
        if (delayWrite) {
          entered.resolve()
          await release.promise
        }
        values.set(key, value)
      },
    }
    const connection = snapshotConnectionOverSync(
      { connect: () => ({ push: () => undefined, subscribe: () => () => undefined }) },
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', storage },
    )
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: () => undefined })
    delayWrite = true
    const saving = connection.save(
      snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Pending' }], Paragraph: [] }),
    )
    await entered.promise

    Expect(connection.writes.status('Note', 'Note-1')).toEqual({ failed: 0, queued: 0, records: [] })

    release.resolve()
    await saving
    Expect(connection.writes.status('Note', 'Note-1')).toMatchObject({ failed: 0, queued: 1 })
  })

  Test('skips an explicit retry whose queued automatic push was acknowledged first', async () => {
    let observer: TaoSyncObserver | undefined
    let recover = false
    const attempts: TaoChangeSet[] = []
    const connection = snapshotConnectionOverSync(
      {
        connect: () => ({
          push: changeSet => {
            attempts.push(changeSet)
            if (!recover) {
              throw new HostEnvironmentError('offline')
            }
            observer?.accepted(changeSet.id)
          },
          subscribe: next => {
            observer = next
            return () => undefined
          },
        }),
      },
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', storage: memoryKeyValueStorage() },
    )
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'First' }], Paragraph: [] }))
    await settle()
    const failed = attempts[0]!

    recover = true
    observer!.online()
    connection.writes.retry('Note', 'Note-1')
    await settle()

    Expect(attempts.filter(changeSet => changeSet.id === failed.id)).toHaveLength(2)
    Expect(connection.writes.status('Note', 'Note-1')).toMatchObject({ failed: 0, queued: 0 })
  })

  Test('holds an automatically retried write until its later acceptance before sending it again', async () => {
    let observer: TaoSyncObserver | undefined
    let recover = false
    const attempts: TaoChangeSet[] = []
    const connection = snapshotConnectionOverSync(
      {
        connect: () => ({
          push: changeSet => {
            attempts.push(changeSet)
            if (!recover) {
              throw new HostEnvironmentError('offline')
            }
          },
          subscribe: next => {
            observer = next
            return () => undefined
          },
        }),
      },
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', storage: memoryKeyValueStorage() },
    )
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'First' }], Paragraph: [] }))
    await settle()
    const failed = attempts[0]!

    recover = true
    observer!.online()
    connection.writes.retry('Note', 'Note-1')
    await settle()

    Expect(attempts.filter(changeSet => changeSet.id === failed.id)).toHaveLength(2)
    Expect(connection.writes.status('Note', 'Note-1')).toMatchObject({ failed: 0, queued: 1 })

    observer!.accepted(failed.id)
    await settle()
    Expect(connection.writes.status('Note', 'Note-1')).toMatchObject({ failed: 0, queued: 0 })
  })

  Test('reoffers an unresolved push after reconnecting from a transport that never settles', async () => {
    const entered = Deferred<void>()
    const release = Deferred<void>()
    const attempts: TaoChangeSet[] = []
    let connections = 0
    const connection = snapshotConnectionOverSync(
      {
        connect: () => {
          connections += 1
          return {
            push: changeSet => {
              attempts.push(changeSet)
              if (connections === 1) {
                entered.resolve()
                return release.promise
              }
              return undefined
            },
            subscribe: () => () => undefined,
          }
        },
      },
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', storage: memoryKeyValueStorage() },
    )
    await connection.load()
    connection.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'First' }], Paragraph: [] }))
    await entered.promise

    connection.close?.()
    connection.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await settle()

    Expect(attempts).toHaveLength(2)
    release.resolve()
  })

  Test('keeps a checkpoint across schema-name changes and structurally separates scope/key pairs', async () => {
    const storage = memoryKeyValueStorage()
    const provider: TaoSyncProvider = {
      connect: () => ({ push: () => undefined, subscribe: () => () => undefined }),
    }
    const first = snapshotConnectionOverSync(
      provider,
      { configuration: {}, schema: definition, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', scope: 'cloud:one', storage },
    )
    await first.load()
    first.subscribe!({ error: () => undefined, snapshot: () => undefined })
    await first.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Kept' }], Paragraph: [] }))

    const renamed = { ...definition, name: 'SyncTestWithAnotherCollection' }
    const relaunched = snapshotConnectionOverSync(
      provider,
      { configuration: {}, schema: renamed, storageKey: 'Notes' },
      { origin: 'aaaaaaaa', scope: 'cloud:one', storage },
    )
    Expect(rows((await relaunched.load()) ?? '').Note[0]?.Title).toBe('Kept')

    const aliasA = snapshotConnectionOverSync(
      provider,
      { configuration: {}, schema: definition, storageKey: 'b:c' },
      { origin: 'aaaaaaaa', scope: 'a', storage },
    )
    const aliasB = snapshotConnectionOverSync(
      provider,
      { configuration: {}, schema: definition, storageKey: 'c' },
      { origin: 'bbbbbbbb', scope: 'a:b', storage },
    )
    await aliasA.load()
    await aliasB.load()
    await aliasA.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'A' }], Paragraph: [] }))
    Expect(rows((await aliasB.load()) ?? '').Note).toEqual([])
  })

  Test('orders transport-minted stamps by wall time, then origin, below any later local edit', () => {
    const earlier = stampAt(1_000, 'cloudkit')
    const later = stampAt(2_000, 'aaaaaaaa')
    Expect(earlier < later).toBe(true)
    Expect(stampAt(1_000, 'aaaaaaaa') < stampAt(1_000, 'bbbbbbbb')).toBe(true)
    Expect(earlier).toMatch(/^[0-9a-f]{16}cloudkit$/u)
  })

  Test("does not republish when the authority echoes this replica's own change-set", async () => {
    const world = createWorld()
    const a = await world.replica('aaaaaaaa')
    await a.connection.save(snapshot({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Mine' }], Paragraph: [] }))
    await settle()
    // The memory authority delivers every accepted change-set to every member, the pusher included.
    Expect(world.authority.history).toHaveLength(1)
    Expect(a.snapshots).toEqual([])
  })
})

function createWorld(): {
  authority: ReturnType<typeof createMemorySyncAuthority>
  replica(origin: string, options?: { online?: boolean; storage?: Replica['storage'] }): Promise<Replica>
} {
  const authority = createMemorySyncAuthority()
  let clock = 1_000
  return {
    authority,
    replica: async (origin, options = {}) => {
      const provider = authority.provider({ online: options.online ?? true })
      const storage = options.storage ?? memoryKeyValueStorage()
      const connection = snapshotConnectionOverSync(
        provider,
        { configuration: {}, schema: definition, storageKey: 'Notes' },
        { now: () => clock++, origin, storage },
      )
      const snapshots: string[] = []
      await connection.load()
      connection.subscribe!({ error: () => undefined, snapshot: value => snapshots.push(value ?? '') })
      await settle()
      return { connection, provider, snapshots, storage }
    },
  }
}

function snapshot(rowsByEntity: Rows): string {
  return JSON.stringify({ formatVersion: 1, nextId: 2, rows: rowsByEntity, schemaVersion: 1 })
}

function rows(serialized: string): Rows {
  return (JSON.parse(serialized) as { rows: Rows }).rows
}

/** current reads a replica's projection as a fresh mount would load it. */
async function current(replica: Replica): Promise<Rows> {
  return rows((await replica.connection.load()) ?? '')
}

function latest(values: readonly string[]): string {
  return values[values.length - 1] ?? ''
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
}
