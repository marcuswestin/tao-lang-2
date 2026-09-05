import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type {
  TaoDataConnection,
  TaoDataConnectionObserver,
  TaoDataProvider,
  TaoDataProviderContext,
  TaoDataSchemaDefinition,
  TaoKeyValueStorage,
} from '../TaoRuntime-src/TR-data'
import { memoryDataProvider, memoryKeyValueStorage, testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import { HostEnvironmentError, UserInputError } from '../TaoRuntime-src/TR-errors'

const noteDefinition: TaoDataSchemaDefinition = {
  name: 'RuntimeNotes',
  schemaVersion: 1,
  entities: {
    Note: {
      collection: 'Notes',
      fields: {
        Title: { kind: 'text' },
        Done: { kind: 'boolean', defaultValue: false },
        CreatedAt: { kind: 'time', defaultNow: true, indexed: true },
      },
    },
  },
}

Describe('TR.Data provider foundation', () => {
  Test('configures and patches declaration-owned providers without losing identity', async () => {
    const provider = memoryDataProvider()
    const declaration = TR.Data.Declaration('Memory', provider)
    const sameNamedDeclaration = TR.Data.Declaration('Memory', memoryDataProvider())
    const base = TR.Data.Configure(declaration, { StorageKey: TR.Value('base-notes') })
    const configured = TR.Data.Patch(base, { StorageKey: TR.Value('patched-notes') })

    Expect(Object.isFrozen(declaration)).toBe(true)
    Expect(Object.isFrozen(base)).toBe(true)
    Expect(Object.isFrozen(base.config)).toBe(true)
    Expect(declaration.identity).not.toBe(sameNamedDeclaration.identity)
    Expect(configured.declaration).toBe(declaration)
    Expect(configured.evaluate()).toBe(configured)
    Expect((base.config['StorageKey'] as TR.Value<string>).jsValue).toBe('base-notes')

    const schema = TR.Data.Schema(noteDefinition)
    TR.Data.BindConfigured(schema, configured)
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Configured') })
    await TR.Data.Settle(schema)
    const revision = schema.snapshot()

    TR.Data.BindConfigured(schema, configured)

    Expect(schema.snapshot()).toBe(revision)
    Expect(await providerConnection(provider, 'base-notes').load()).toBeUndefined()
    Expect(await providerConnection(provider, 'patched-notes').load()).toContain('Configured')
  })

  Test('publishes Memory through the DataProvider protocol and conformance suite', async () => {
    const rejectingProvider = (): TR.DataProvider => ({
      connect: () => ({
        load: () => undefined,
        save: () => {
          throw new HostEnvironmentError('deterministic rejection')
        },
      }),
    })

    await TR.testProvider(memoryDataProvider, rejectingProvider)
  })

  Test('ports Local through conformance with a deterministic storage boundary', async () => {
    const values = new Map<string, string>()
    const storage = memoryKeyValueStorage(values)
    const rejectingStorage = {
      getItem: async (_key: string): Promise<string | null> => null,
      setItem: async (_key: string, _value: string): Promise<void> => {
        throw new HostEnvironmentError('storage unavailable')
      },
    }

    await TR.testProvider(
      () => localProvider(storage, 'provider-conformance'),
      () => localProvider(rejectingStorage, 'provider-conformance-rejection'),
    )
  })

  Test('isolates in-memory envelopes by storage key', async () => {
    const provider = memoryDataProvider()
    const first = providerConnection(provider, 'first-schema')
    const second = providerConnection(provider, 'second-schema')

    await first.save('first')
    await second.save('second')

    Expect(await first.load()).toBe('first')
    Expect(await second.load()).toBe('second')
    Expect(await providerConnection(provider, 'missing-schema').load()).toBeUndefined()
  })

  Test('rejects schema fields that collide with the generated entity identifier', () => {
    Expect(() =>
      TR.Data.Schema({
        name: 'ReservedFields',
        entities: {
          Entry: { collection: 'Entries', fields: { Id: { kind: 'text' } } },
        },
      }, memoryConnection())
    ).toThrow("Entity 'Entry' cannot declare reserved field 'Id'.")
  })

  Test('surfaces an unbound-provider error when schema construction has no provider source', async () => {
    const schema = TR.Data.Schema(noteDefinition)
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows.Error).toContain("Data schema 'RuntimeNotes' has no bound provider.")
  })

  Test('binds one declared Memory provider and preserves the store across repeated app renders', () => {
    const declaration = TR.Data.Declaration('Memory', memoryDataProvider())
    const configured = TR.Data.Configure(declaration, {})
    const schema = TR.Data.Schema(noteDefinition)
    TR.Data.BindConfigured(schema, configured)
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Bound') })
    const revisionBeforeRepeat = schema.snapshot()

    TR.Data.BindConfigured(schema, configured)

    Expect(schema.snapshot()).toBe(revisionBeforeRepeat)
    Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(1)
  })

  Test('keeps the fresh test Memory provider when app binding runs during a check', () => {
    const local = TR.Data.Configure(
      TR.Data.Declaration('Local', localProvider(memoryKeyValueStorage(new Map()))),
      { StorageKey: TR.Value('test-isolation') },
    )
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    try {
      TR.Data.beginTest()
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Isolated') })

      TR.Data.BindConfigured(schema, local)

      Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(1)
      Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Loading: boolean }).Loading).toBe(false)
    } finally {
      TR.Data.endTest()
    }
  })

  Test('applies only declared defaults and creates stable live entity handles', () => {
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    const before = Date.now()

    TR.Data.Create(schema, 'Note', { Title: TR.Value('Draft') })
    const first = schema.query({ entity: 'Note', filters: [] })[0] as Record<string, unknown>
    const second = schema.query({ entity: 'Note', filters: [] })[0] as Record<string, unknown>

    Expect(first).toBe(second)
    Expect(first['Done']).toBe(false)
    Expect(typeof first['CreatedAt']).toBe('number')
    Expect(first['CreatedAt'] as number).toBeGreaterThanOrEqual(before)

    TR.Data.Update(TR.Value(first), { Title: TR.Value('Current') })
    Expect(first['Title']).toBe('Current')
    Expect(TR.Data.Read(first, 'Title')).toBe('Current')
    Expect(() => TR.Data.Create(schema, 'Note', {})).toThrow(
      "Create of 'Note' is missing required field 'Title'.",
    )
  })

  Test('derives entity guard availability while preserving a deleted handle identifier', () => {
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Transient') })
    const note = schema.query({ entity: 'Note', filters: [] })[0] as Record<string, unknown>
    const cases: string[] = []
    const branches = [
      ['loading', () => cases.push('loading')],
      ['missing', () => cases.push('missing')],
      ['unauthorized', () => cases.push('unauthorized')],
      ['error', (message: TR.Value<string>) => cases.push(`error: ${message.jsValue}`)],
    ] as const

    Expect(TR.Data.EntityAvailability(note)).toEqual({ status: 'available' })
    Expect(TR.GuardAction(TR.Value(note), branches)).toBe(false)

    schema.setStatus('loading', '')
    Expect(TR.GuardAction(TR.Value(note), branches)).toBe(true)
    schema.setStatus('error', 'Provider unavailable')
    Expect(TR.GuardAction(TR.Value(note), branches)).toBe(true)
    schema.setStatus('ready', '')

    const id = note['Id']
    TR.Data.Delete(TR.Value(note))
    Expect(note['Id']).toBe(id)
    Expect(TR.Data.Read(note, 'Id')).toBe(id)
    Expect(TR.Data.EntityAvailability(note)).toEqual({ status: 'missing' })
    Expect(TR.GuardAction(TR.Value(note), branches)).toBe(true)
    Expect(cases).toEqual(['loading', 'error: Provider unavailable', 'missing'])
  })

  Test('renders an unauthorized entity guard from provider status', () => {
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Private') })
    const note = schema.query({ entity: 'Note', filters: [] })[0] as Record<string, unknown>

    schema.setStatus('unauthorized', '')

    Expect(
      TR.GuardRender(
        TR.Value(note),
        [['unauthorized', () => 'You no longer have access to this document.']],
        () => 'Document editor',
      ),
    ).toBe('You no longer have access to this document.')

    schema.setStatus('ready', '')
    Expect(TR.GuardRender(TR.Value(note), [], () => 'Document editor')).toBe('Document editor')
  })

  Test('keeps the text literal "now" distinct from the time clock default', () => {
    const schema = TR.Data.Schema({
      name: 'DefaultKinds',
      entities: {
        Entry: {
          collection: 'Entries',
          fields: {
            Label: { kind: 'text', defaultValue: 'now' },
            CreatedAt: { kind: 'time', defaultNow: true },
          },
        },
      },
    }, memoryConnection())
    const before = Date.now()

    TR.Data.Create(schema, 'Entry', {})

    const entry = schema.query({ entity: 'Entry', filters: [] })[0] as Record<string, unknown>
    Expect(entry['Label']).toBe('now')
    Expect(typeof entry['CreatedAt']).toBe('number')
    Expect(entry['CreatedAt'] as number).toBeGreaterThanOrEqual(before)
  })

  Test('applies the now clock separately for every create while preserving live handle identity', () => {
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    const originalNow = Date.now
    let currentTime = 1_000
    Date.now = () => currentTime
    try {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('First') })
      const first = schema.query({ entity: 'Note', filters: [] })[0] as Record<string, unknown>
      currentTime = 2_000
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Second') })
      const again = schema.query({ entity: 'Note', filters: [] })[0]
      const second = schema.query({ entity: 'Note', filters: [] })[1] as Record<string, unknown>

      Expect(again).toBe(first)
      Expect(first['CreatedAt']).toBe(1_000)
      Expect(second['CreatedAt']).toBe(2_000)
    } finally {
      Date.now = originalNow
    }
  })

  Test('combines repeated query filters with AND and applies one deterministic order', () => {
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('B') })
    TR.Data.Create(schema, 'Note', { Title: TR.Value('A'), Done: TR.Value(true) })
    TR.Data.Create(schema, 'Note', { Title: TR.Value('C') })
    TR.Data.Create(schema, 'Note', { Title: TR.Value('D') })

    const rows = schema.query({
      entity: 'Note',
      filters: [
        { field: 'Done', operator: '==', value: () => TR.Value(false) },
        { field: 'Title', operator: '!=', value: () => TR.Value('B') },
      ],
      order: { direction: 'desc', field: 'Title' },
    }) as Array<Record<string, unknown>>

    Expect(rows.map(row => row['Title'])).toEqual(['D', 'C'])
  })

  Test('applies explicit true defaults and entity ordering to unordered queries', () => {
    const schema = TR.Data.Schema({
      name: 'OrderedDefaults',
      entities: {
        Entry: {
          collection: 'Entries',
          defaultOrder: { direction: 'asc', field: 'Position' },
          fields: {
            Title: { kind: 'text' },
            Position: { kind: 'number' },
            Public: { kind: 'boolean', defaultValue: true },
          },
        },
      },
    }, memoryConnection())
    TR.Data.Create(schema, 'Entry', {
      Title: TR.Value('Later'),
      Position: TR.Value(20),
      Public: TR.Value(false),
    })
    TR.Data.Create(schema, 'Entry', {
      Title: TR.Value('Earlier'),
      Position: TR.Value(10),
    })

    const rows = schema.query({ entity: 'Entry', filters: [] }) as Array<Record<string, unknown>>

    Expect(rows.map(row => row['Title'])).toEqual(['Earlier', 'Later'])
    Expect(rows.map(row => row['Public'])).toEqual([true, false])
  })

  Test('persists the versioned id counter and reloads without identifier collisions', async () => {
    const values = new Map<string, string>()
    const storage = memoryKeyValueStorage(values)
    const provider = providerConnection(localProvider(storage, 'persisted-id-test'), noteDefinition.name)
    const first = TR.Data.Schema(noteDefinition, provider)
    await TR.Data.Settle(first)
    TR.Data.Create(first, 'Note', { Title: TR.Value('First') })
    await TR.Data.Settle(first)

    const second = TR.Data.Schema(noteDefinition, provider)
    await TR.Data.Settle(second)
    TR.Data.Create(second, 'Note', { Title: TR.Value('Second') })
    await TR.Data.Settle(second)

    const ids = second.query({ entity: 'Note', filters: [] }).map(row => (row as Record<string, unknown>)['Id'])
    Expect(ids).toEqual(['Note-1', 'Note-2'])
    const envelope = JSON.parse([...values.values()][0]!) as Record<string, unknown>
    Expect(envelope['formatVersion']).toBe(1)
    Expect(envelope['schemaVersion']).toBe(1)
    Expect(envelope['nextId']).toBe(3)
  })

  Test('serializes saves in mutation order and surfaces save failure', async () => {
    const saves: string[] = []
    const gates: Array<Deferred<void>> = []
    const provider: TaoDataConnection = {
      load: () => undefined,
      save: value => {
        saves.push(value)
        const gate = new Deferred<void>()
        gates.push(gate)
        return gate.promise
      },
    }
    const schema = TR.Data.Schema(noteDefinition, provider)
    TR.Data.Create(schema, 'Note', { Title: TR.Value('First') })
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Second') })

    await flushMicrotasks()
    Expect(saves).toHaveLength(1)
    gates[0]!.resolve()
    await flushMicrotasks()
    Expect(saves).toHaveLength(2)
    gates[1]!.reject(new Error('disk full'))
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows).toHaveLength(2)
    Expect(rows.Error).toContain('Could not save data: disk full')
  })

  Test('recovers from a failed save when a newer queued snapshot saves successfully', async () => {
    let saveCount = 0
    let durable = ''
    const provider: TaoDataConnection = {
      load: () => undefined,
      save: value => {
        saveCount += 1
        if (saveCount === 1) {
          throw new HostEnvironmentError('temporary outage')
        }
        durable = value
      },
    }
    const schema = TR.Data.Schema(noteDefinition, provider)

    TR.Data.Create(schema, 'Note', { Title: TR.Value('First') })
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Second') })
    await TR.Data.Settle(schema)

    const recovered = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(recovered).toHaveLength(2)
    Expect(recovered.Error).toBe('')
    Expect((JSON.parse(durable) as { rows: { Note: unknown[] } }).rows.Note).toHaveLength(2)

    TR.Data.Create(schema, 'Note', { Title: TR.Value('Third') })
    await TR.Data.Settle(schema)
    Expect(saveCount).toBe(3)
  })

  Test('reports corrupt persisted envelopes instead of accepting partial data', async () => {
    const provider = memoryConnection('{"formatVersion":1,"schemaVersion":1,"nextId":2,"rows":{}}')
    const schema = TR.Data.Schema(noteDefinition, provider)
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows).toHaveLength(0)
    Expect(rows.Error).toContain('entity collections do not match')
  })

  Test('resets a disposable store itself when its starting snapshot no longer parses', async () => {
    let stored: string | undefined = '{"formatVersion":1,"schemaVersion":1,"nextId":2,"rows":{}}'
    let resets = 0
    const connection: TaoDataConnection = {
      automaticReset: true,
      load: () => stored,
      reset: () => {
        resets += 1
        stored = undefined
      },
      save: value => {
        stored = value
      },
    }
    const schema = TR.Data.Schema(noteDefinition, connection)
    await TR.Data.Settle(schema)
    await flushMicrotasks()
    await TR.Data.Settle(schema)

    Expect(resets).toBe(1)
    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows).toHaveLength(0)
    Expect(rows.Error).toBe('')

    TR.Data.Create(schema, 'Note', { Title: TR.Value('Fresh') })
    await TR.Data.Settle(schema)
    Expect(stored).toContain('Fresh')
  })

  Test('spends one automatic reset per corrupt load and then reports the failure', async () => {
    const corrupt = '{"formatVersion":1,"schemaVersion":1,"nextId":2,"rows":{}}'
    let resets = 0
    const connection: TaoDataConnection = {
      automaticReset: true,
      load: () => corrupt,
      reset: () => {
        resets += 1
      },
      save: () => {},
    }
    const schema = TR.Data.Schema(noteDefinition, connection)
    await TR.Data.Settle(schema)
    await flushMicrotasks()
    await TR.Data.Settle(schema)

    Expect(resets).toBe(1)
    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows.Error).toContain('entity collections do not match')
  })

  Test('never resets a corrupt store that did not opt into automatic reset', async () => {
    let resets = 0
    const connection: TaoDataConnection = {
      load: () => '{"formatVersion":1,"schemaVersion":1,"nextId":2,"rows":{}}',
      reset: () => {
        resets += 1
      },
      save: () => {},
    }
    const schema = TR.Data.Schema(noteDefinition, connection)
    await TR.Data.Settle(schema)
    await flushMicrotasks()

    Expect(resets).toBe(0)
    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows.Error).toContain('entity collections do not match')
  })

  Test('rejects persisted duplicate identifiers before handles can let rows', async () => {
    const duplicateRows = JSON.stringify({
      formatVersion: 1,
      schemaVersion: 1,
      nextId: 2,
      rows: {
        Note: [
          { Id: 'Note-1', Title: 'First', Done: false, CreatedAt: 1 },
          { Id: 'Note-1', Title: 'Second', Done: false, CreatedAt: 2 },
        ],
      },
    })
    const schema = TR.Data.Schema(noteDefinition, memoryConnection(duplicateRows))
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows).toHaveLength(0)
    Expect(rows.Error).toContain("Persisted entity 'Note' contains duplicate Id values.")
  })

  Test('ignores a stale async load after provider reconfiguration', async () => {
    const stale = new Deferred<string | undefined>()
    const staleProvider: TaoDataConnection = {
      load: () => stale.promise,
      save: () => {},
    }
    const schema = TR.Data.Schema(noteDefinition, staleProvider)
    schema.configure(memoryConnection())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Current') })
    stale.resolve(persistedNotes('Stale'))
    await flushMicrotasks()

    const rows = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>>
    Expect(rows.map(row => row['Title'])).toEqual(['Current'])
  })

  Test('applies live provider snapshots and releases the connection on reconfiguration', async () => {
    let observer: TaoDataConnectionObserver | undefined
    let closed = false
    let unsubscribed = false
    const liveConnection: TaoDataConnection = {
      close: () => {
        closed = true
      },
      load: () => undefined,
      save: () => {},
      subscribe: next => {
        observer = next
        return () => {
          unsubscribed = true
        }
      },
    }
    const schema = TR.Data.Schema(noteDefinition, liveConnection)
    await TR.Data.Settle(schema)

    observer?.snapshot(persistedNotes('Remote'))

    const rows = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>>
    Expect(rows.map(row => row['Title'])).toEqual(['Remote'])

    const staleObserver = observer
    schema.configure(memoryConnection())
    staleObserver?.snapshot(persistedNotes('Stale remote'))

    Expect(unsubscribed).toBe(true)
    // The outgoing connection closes only after its queued saves settle.
    Expect(closed).toBe(false)
    await flushMicrotasks()
    Expect(closed).toBe(true)
    Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(0)
  })

  Test('keeps ready data visible through live errors and recovers on the next snapshot', async () => {
    let observer: TaoDataConnectionObserver | undefined
    const liveConnection: TaoDataConnection = {
      load: () => persistedNotes('Loaded'),
      save: () => {},
      subscribe: next => {
        observer = next
        return () => {}
      },
    }
    const schema = TR.Data.Schema(noteDefinition, liveConnection)
    await TR.Data.Settle(schema)

    observer?.error(new Error('offline'))

    const unavailable = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>> & {
      Error: string
    }
    Expect(unavailable.map(row => row['Title'])).toEqual(['Loaded'])
    Expect(unavailable.Error).toContain('Could not synchronize data: offline')

    observer?.snapshot(persistedNotes('Recovered'))
    const recovered = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>> & {
      Error: string
    }
    Expect(recovered.map(row => row['Title'])).toEqual(['Recovered'])
    Expect(recovered.Error).toBe('')
  })

  Test('keeps local state when a remote snapshot arrives during an ordered save', async () => {
    const pendingSave = new Deferred<void>()
    let observer: TaoDataConnectionObserver | undefined
    const liveConnection: TaoDataConnection = {
      load: () => undefined,
      save: () => pendingSave.promise,
      subscribe: next => {
        observer = next
        return () => {}
      },
    }
    const schema = TR.Data.Schema(noteDefinition, liveConnection)
    await flushMicrotasks()

    TR.Data.Create(schema, 'Note', { Title: TR.Value('Local') })
    observer?.snapshot(persistedNotes('Remote during save'))

    const duringSave = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>>
    Expect(duringSave.map(row => row['Title'])).toEqual(['Local'])

    pendingSave.resolve()
    await TR.Data.Settle(schema)
    observer?.snapshot(persistedNotes('Remote after save'))

    const afterSave = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>>
    Expect(afterSave.map(row => row['Title'])).toEqual(['Remote after save'])
  })

  Test('invalidates live handles when the schema changes provider generations', () => {
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Old store') })
    const oldHandle = schema.query({ entity: 'Note', filters: [] })[0]

    schema.configure(memoryConnection())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('New store') })
    const newHandle = schema.query({ entity: 'Note', filters: [] })[0]

    Expect(newHandle).not.toBe(oldHandle)
    Expect(() => TR.Data.Update(TR.Value(oldHandle), { Title: TR.Value('Corrupt') })).toThrow(
      "Entity handle 'Note-1' belongs to an inactive provider generation.",
    )
    Expect((newHandle as Record<string, unknown>)['Title']).toBe('New store')
  })

  Test('normalizes entity handles in filters and cascades relationships transitively in one save', async () => {
    let saves = 0
    const provider: TaoDataConnection = {
      load: () => undefined,
      save: () => {
        saves += 1
      },
    }
    const definition: TaoDataSchemaDefinition = {
      name: 'Cascade',
      entities: {
        Workspace: { collection: 'Workspaces', fields: { Name: { kind: 'text' } } },
        Task: {
          collection: 'Tasks',
          fields: {
            Title: { kind: 'text' },
            Workspace: { kind: 'relation', relation: 'Workspace', onDelete: 'cascade' },
          },
        },
        Comment: {
          collection: 'Comments',
          fields: {
            Body: { kind: 'text' },
            Task: { kind: 'relation', relation: 'Task', onDelete: 'cascade' },
          },
        },
      },
    }
    const schema = TR.Data.Schema(definition, provider)
    TR.Data.Create(schema, 'Workspace', { Name: TR.Value('Home') })
    const workspace = schema.query({ entity: 'Workspace', filters: [] })[0]
    TR.Data.Create(schema, 'Task', { Title: TR.Value('Plan'), Workspace: TR.Value(workspace) })
    const task = schema.query({
      entity: 'Task',
      filters: [{ field: 'Workspace', operator: '==', value: () => TR.Value(workspace) }],
    })[0]
    const relatedWorkspace = TR.Data.Read(task, 'Workspace') as Record<string, unknown>
    Expect(relatedWorkspace).toBe(workspace)
    TR.Data.Update(TR.Value(workspace), { Name: TR.Value('Current Home') })
    Expect(relatedWorkspace['Name']).toBe('Current Home')
    Expect((task as Record<string, unknown>)['Workspace']).toBe(workspace)
    TR.Data.Create(schema, 'Comment', { Body: TR.Value('First'), Task: TR.Value(task) })
    await TR.Data.Settle(schema)
    saves = 0

    TR.Data.Delete(TR.Value(workspace))
    await TR.Data.Settle(schema)

    Expect(schema.query({ entity: 'Workspace', filters: [] })).toHaveLength(0)
    Expect(schema.query({ entity: 'Task', filters: [] })).toHaveLength(0)
    Expect(schema.query({ entity: 'Comment', filters: [] })).toHaveLength(0)
    Expect(saves).toBe(1)
  })

  Test('cascades three levels from owner-declared collection semantics', () => {
    const schema = TR.Data.Schema({
      name: 'OwnerCascade',
      entities: {
        Workspace: { collection: 'Workspaces', fields: { Name: { kind: 'text' } } },
        Document: {
          collection: 'Documents',
          fields: {
            Title: { kind: 'text' },
            Workspace: { kind: 'relation', relation: 'Workspace', onDelete: 'cascade' },
          },
        },
        Paragraph: {
          collection: 'Paragraphs',
          fields: {
            Text: { kind: 'text' },
            Document: { kind: 'relation', relation: 'Document', onDelete: 'cascade' },
          },
        },
      },
    }, memoryConnection())
    TR.Data.Create(schema, 'Workspace', { Name: TR.Value('Home') })
    const workspace = schema.query({ entity: 'Workspace', filters: [] })[0]
    TR.Data.Create(schema, 'Document', { Title: TR.Value('Draft'), Workspace: TR.Value(workspace) })
    const document = schema.query({ entity: 'Document', filters: [] })[0]
    TR.Data.Create(schema, 'Paragraph', { Text: TR.Value('Opening'), Document: TR.Value(document) })

    TR.Data.Delete(TR.Value(workspace))

    Expect(schema.query({ entity: 'Workspace', filters: [] })).toHaveLength(0)
    Expect(schema.query({ entity: 'Document', filters: [] })).toHaveLength(0)
    Expect(schema.query({ entity: 'Paragraph', filters: [] })).toHaveLength(0)
  })

  Test('rejects foreign, wrong-entity, deleted, and inactive relationship handles', () => {
    const primary = TR.Data.Schema(relationshipDefinition('PrimaryRelationships'), memoryConnection())
    const foreign = TR.Data.Schema(relationshipDefinition('ForeignRelationships'), memoryConnection())
    TR.Data.Create(primary, 'Workspace', { Name: TR.Value('Primary') })
    TR.Data.Create(foreign, 'Workspace', { Name: TR.Value('Foreign') })
    const primaryWorkspace = primary.query({ entity: 'Workspace', filters: [] })[0]
    const foreignWorkspace = foreign.query({ entity: 'Workspace', filters: [] })[0]
    TR.Data.Create(primary, 'Task', {
      Title: TR.Value('Owned'),
      Workspace: TR.Value(primaryWorkspace),
    })

    Expect(() =>
      TR.Data.Create(primary, 'Task', {
        Title: TR.Value('Foreign write'),
        Workspace: TR.Value(foreignWorkspace),
      })
    ).toThrow(/Relationship 'Task\.Workspace'.*different data schema/)
    Expect(() =>
      primary.query({
        entity: 'Task',
        filters: [{ field: 'Workspace', operator: '==', value: () => TR.Value(foreignWorkspace) }],
      })
    ).toThrow(/Query filter 'Task\.Workspace'.*different data schema/)

    const primaryTask = primary.query({ entity: 'Task', filters: [] })[0]
    Expect(() =>
      primary.query({
        entity: 'Task',
        filters: [{ field: 'Workspace', operator: '==', value: () => TR.Value(primaryTask) }],
      })
    ).toThrow("Query filter 'Task.Workspace' expects Workspace, got Task.")

    TR.Data.Create(primary, 'Workspace', { Name: TR.Value('Temporary') })
    const deletedWorkspace = primary.query({ entity: 'Workspace', filters: [] })[1]
    TR.Data.Delete(TR.Value(deletedWorkspace))
    Expect(() =>
      primary.query({
        entity: 'Task',
        filters: [{ field: 'Workspace', operator: '==', value: () => TR.Value(deletedWorkspace) }],
      })
    ).toThrow(/Query filter 'Task\.Workspace' refers to missing Workspace/)

    primary.configure(memoryConnection())
    Expect(() =>
      primary.query({
        entity: 'Task',
        filters: [{ field: 'Workspace', operator: '==', value: () => TR.Value(primaryWorkspace) }],
      })
    ).toThrow("Entity handle 'Workspace-1' belongs to an inactive provider generation.")
  })

  Test('restricts deletion when a relationship does not explicitly opt into cascade', () => {
    const definition: TaoDataSchemaDefinition = {
      name: 'RestrictedRelationship',
      entities: {
        Parent: { collection: 'Parents', fields: { Name: { kind: 'text' } } },
        Child: {
          collection: 'Children',
          fields: {
            Name: { kind: 'text' },
            Parent: { kind: 'relation', relation: 'Parent' },
          },
        },
      },
    }
    const schema = TR.Data.Schema(definition, memoryConnection())
    TR.Data.Create(schema, 'Parent', { Name: TR.Value('Protected') })
    const parent = schema.query({ entity: 'Parent', filters: [] })[0]
    TR.Data.Create(schema, 'Child', { Name: TR.Value('Dependent'), Parent: TR.Value(parent) })

    Expect(() => TR.Data.Delete(TR.Value(parent))).toThrow(
      "Cannot delete Parent 'Parent-1' because Child.Parent still refers to it.",
    )
    Expect(schema.query({ entity: 'Parent', filters: [] })).toHaveLength(1)
    Expect(schema.query({ entity: 'Child', filters: [] })).toHaveLength(1)
  })
})

Describe('TR.Data save and sync reconciliation', () => {
  Test('keeps a failed save visible through a stale remote echo, then clears on confirmation', async () => {
    let observer: TaoDataConnectionObserver | undefined
    let rejectSaves = false
    let lastAttempted: string | undefined
    let lastSaved: string | undefined
    const connection: TaoDataConnection = {
      load: () => undefined,
      save: value => {
        lastAttempted = value
        if (rejectSaves) {
          throw new HostEnvironmentError('network blip')
        }
        lastSaved = value
      },
      subscribe: next => {
        observer = next
        return () => {}
      },
    }
    const schema = TR.Data.Schema(noteDefinition, connection)
    await TR.Data.Settle(schema)
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Durable') })
    await TR.Data.Settle(schema)
    const durableSnapshot = lastSaved!

    rejectSaves = true
    TR.Data.Create(schema, 'Note', { Title: TR.Value('At risk') })
    await TR.Data.Settle(schema)

    // The provider pushes the old server state after the failed save. The unsaved write must stay
    // visible with its error rather than being silently reverted.
    observer?.snapshot(durableSnapshot)
    const held = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>> & {
      Error: string
    }
    Expect(held.map(row => row['Title'])).toEqual(['Durable', 'At risk'])
    Expect(held.Error).toContain('Could not save data: network blip')

    // The provider later confirms the exact local snapshot — the write is durable, error clears.
    observer?.snapshot(lastAttempted)
    const confirmed = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(confirmed).toHaveLength(2)
    Expect(confirmed.Error).toBe('')
  })

  Test('allows retrying writes after a failed save and clears the error when the retry saves', async () => {
    let rejectSaves = true
    let lastSaved: string | undefined
    const connection: TaoDataConnection = {
      load: () => undefined,
      save: value => {
        if (rejectSaves) {
          throw new HostEnvironmentError('temporary outage')
        }
        lastSaved = value
      },
    }
    const schema = TR.Data.Schema(noteDefinition, connection)
    await TR.Data.Settle(schema)
    TR.Data.Create(schema, 'Note', { Title: TR.Value('First try') })
    await TR.Data.Settle(schema)
    Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }).Error)
      .toContain('Could not save data')

    rejectSaves = false
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Retry') })
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows).toHaveLength(2)
    Expect(rows.Error).toBe('')
    Expect((JSON.parse(lastSaved!) as { rows: { Note: unknown[] } }).rows.Note).toHaveLength(2)
  })

  Test('drains queued saves to the outgoing connection before closing it on reconfiguration', async () => {
    const gate = new Deferred<void>()
    const saved: string[] = []
    let closed = false
    const slowConnection: TaoDataConnection = {
      close: () => {
        closed = true
      },
      load: () => undefined,
      save: async value => {
        await gate.promise
        saved.push(value)
      },
    }
    const schema = TR.Data.Schema(noteDefinition, slowConnection)
    await flushMicrotasks()
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Committed') })

    schema.configure(memoryConnection())
    Expect(closed).toBe(false)

    gate.resolve()
    await flushMicrotasks()
    await flushMicrotasks()
    Expect(saved).toHaveLength(1)
    Expect(closed).toBe(true)
    Expect((JSON.parse(saved[0]!) as { rows: { Note: unknown[] } }).rows.Note).toHaveLength(1)
  })

  Test('keeps writes available through a live sync error and recovers on an identical snapshot', async () => {
    let observer: TaoDataConnectionObserver | undefined
    let lastSaved: string | undefined
    const connection: TaoDataConnection = {
      load: () => persistedNotes('Synced'),
      save: value => {
        lastSaved = value
      },
      subscribe: next => {
        observer = next
        return () => {}
      },
    }
    const schema = TR.Data.Schema(noteDefinition, connection)
    await TR.Data.Settle(schema)

    observer?.error(new Error('websocket blip'))
    Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }).Error)
      .toContain('Could not synchronize data')

    // A transient sync error must not write-lock the app: the write goes through and its
    // successful save clears the error.
    TR.Data.Update(TR.Value(schema.query({ entity: 'Note', filters: [] })[0]), {
      Title: TR.Value('Written during outage'),
    })
    await TR.Data.Settle(schema)
    const recovered = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>> & {
      Error: string
    }
    Expect(recovered.Error).toBe('')
    Expect(recovered[0]!['Title']).toBe('Written during outage')
    Expect(lastSaved).toContain('Written during outage')

    // A sync error with no local writes clears when the provider pushes the identical snapshot.
    observer?.error(new Error('websocket blip'))
    observer?.snapshot(lastSaved)
    Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }).Error)
      .toBe('')
  })

  Test('degrades a mid-session unparseable snapshot to a recoverable sync failure', async () => {
    let observer: TaoDataConnectionObserver | undefined
    const connection: TaoDataConnection = {
      load: () => persistedNotes('Kept'),
      save: () => {},
      subscribe: next => {
        observer = next
        return () => {}
      },
    }
    const schema = TR.Data.Schema(noteDefinition, connection)
    await TR.Data.Settle(schema)

    // A peer on a newer schema version pushes an envelope this client cannot parse. The last
    // usable data stays visible and writable instead of the app blocking behind the overlay.
    observer?.snapshot('{"formatVersion":99}')
    const held = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>> & {
      Error: string
    }
    Expect(held.map(row => row['Title'])).toEqual(['Kept'])
    Expect(held.Error).toContain('Could not synchronize data')

    TR.Data.Update(TR.Value(held[0]), { Title: TR.Value('Still writable') })
    await TR.Data.Settle(schema)

    observer?.snapshot(persistedNotes('Recovered'))
    const recovered = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>> & {
      Error: string
    }
    Expect(recovered.map(row => row['Title'])).toEqual(['Recovered'])
    Expect(recovered.Error).toBe('')
  })

  Test('replays the latest remote snapshot suppressed while ordered saves were pending', async () => {
    const pendingSave = new Deferred<void>()
    let observer: TaoDataConnectionObserver | undefined
    const connection: TaoDataConnection = {
      load: () => undefined,
      save: () => pendingSave.promise,
      subscribe: next => {
        observer = next
        return () => {}
      },
    }
    const schema = TR.Data.Schema(noteDefinition, connection)
    await flushMicrotasks()
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Local') })

    // A peer's write lands at the provider while our save is pending; its event is suppressed for
    // display but must not be lost once the queue drains.
    observer?.snapshot(persistedNotes('Peer write'))
    const duringSave = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>>
    Expect(duringSave.map(row => row['Title'])).toEqual(['Local'])

    pendingSave.resolve()
    await TR.Data.Settle(schema)
    const afterDrain = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>>
    Expect(afterDrain.map(row => row['Title'])).toEqual(['Peer write'])
  })

  Test('routes a provider that throws on connect into data error state instead of the render', async () => {
    const throwingProvider: TaoDataProvider = {
      connect: () => {
        throw new UserInputError('AppId expects non-empty text.')
      },
    }
    const declaration = TR.Data.Declaration('Broken', throwingProvider)
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())

    TR.Data.BindConfigured(schema, TR.Data.Configure(declaration, {}))
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows.Error).toContain('AppId expects non-empty text.')

    // A corrected configuration rebinds and recovers without a remount.
    const working = TR.Data.Declaration('Working', memoryDataProvider())
    TR.Data.BindConfigured(schema, TR.Data.Configure(working, {}))
    await TR.Data.Settle(schema)
    Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }).Error).toBe('')
  })

  Test('surfaces an invalid StorageKey configuration inside a Tao check, without connecting', async () => {
    let connects = 0
    const provider: TaoDataProvider = {
      connect: () => {
        connects += 1
        return memoryConnection()
      },
    }
    const declaration = TR.Data.Declaration('Configured', provider)
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    try {
      TR.Data.beginTest()
      Expect(() =>
        TR.Data.BindConfigured(
          schema,
          TR.Data.Configure(declaration, { StorageKey: TR.Value(42) }),
        )
      ).toThrow("configuration 'StorageKey' expects text.")
      Expect(connects).toBe(0)
    } finally {
      TR.Data.endTest()
    }
  })
})

Describe('TR.Data', () => {
  Test('persists local rows and applies strict update, relationship cascade, and rehydration', async () => {
    const values = new Map<string, string>()
    const storage = memoryKeyValueStorage(values)
    const definition = {
      name: 'RuntimeDataTest',
      entities: {
        Workspace: { collection: 'Workspaces', fields: { Name: { kind: 'text' as const } } },
        Task: {
          collection: 'Tasks',
          fields: {
            Title: { kind: 'text' as const },
            Workspace: {
              kind: 'relation' as const,
              relation: 'Workspace',
              onDelete: 'cascade' as const,
            },
          },
        },
      },
    }
    const provider = localProvider(storage, 'runtime-test')
    const schema = TR.Data.Schema(definition, providerConnection(provider, 'runtime-data-test', definition))
    await TR.Data.Settle(schema)
    TR.Data.Create(schema, 'Workspace', { Name: TR.Value('Home') })
    Expect(() =>
      TR.Data.Create(schema, 'Task', {
        Title: TR.Value('Draft'),
        Workspace: TR.Value('Workspace-1'),
      })
    ).toThrow("Relationship 'Task.Workspace' expects a live Workspace entity handle.")
    const workspace = schema.query({ entity: 'Workspace', filters: [] })[0]
    TR.Data.Create(schema, 'Task', { Title: TR.Value('Draft'), Workspace: TR.Value(workspace) })
    await TR.Data.Settle(schema)
    const initiallyRehydrated = TR.Data.Schema(
      definition,
      providerConnection(provider, 'runtime-data-test', definition),
    )
    await TR.Data.Settle(initiallyRehydrated)
    Expect(initiallyRehydrated.query({ entity: 'Workspace', filters: [] })).toHaveLength(1)
    Expect(initiallyRehydrated.query({ entity: 'Task', filters: [] })).toHaveLength(1)
    const tasks = schema.query({ entity: 'Task', filters: [] }) as Array<Record<string, unknown>>
    Expect(tasks).toHaveLength(1)
    TR.Data.Update(TR.Value(tasks[0]), { Title: TR.Value('Updated') })
    Expect((schema.query({ entity: 'Task', filters: [] })[0] as Record<string, unknown>)['Title']).toBe('Updated')
    const workspaces = schema.query({ entity: 'Workspace', filters: [] })
    TR.Data.Delete(TR.Value(workspaces[0]))
    Expect(schema.query({ entity: 'Task', filters: [] })).toHaveLength(0)
    await TR.Data.Settle(schema)

    const rehydrated = TR.Data.Schema(definition, providerConnection(provider, 'runtime-data-test', definition))
    await TR.Data.Settle(rehydrated)
    Expect(rehydrated.query({ entity: 'Workspace', filters: [] })).toHaveLength(0)
  })

  Test(
    'rehydrates the version-1 envelope under an explicit key with inverse fields and next-ID continuity',
    async () => {
      const values = new Map<string, string>([[
        'runtime-test:WordFlowerData',
        JSON.stringify({
          formatVersion: 1,
          schemaVersion: 1,
          nextId: 7,
          rows: {
            Workspace: [{ Id: 'Workspace-1', Name: 'Home', CreatedAt: 10 }],
            Document: [{ Id: 'Document-4', Title: 'First', Final: false, Workspace: 'Workspace-1' }],
          },
        }),
      ]])
      const storage = memoryKeyValueStorage(values)
      const definition = {
        name: 'Data',
        schemaVersion: 1,
        entities: {
          Workspace: {
            collection: 'Workspaces',
            defaultOrder: { field: 'CreatedAt', direction: 'asc' as const },
            fields: { Name: { kind: 'text' as const }, CreatedAt: { kind: 'time' as const } },
            inverseFields: { Documents: { relation: 'Document', inverseField: 'Workspace' } },
          },
          Document: {
            collection: 'Documents',
            fields: {
              Title: { kind: 'text' as const },
              Final: { kind: 'boolean' as const, defaultValue: false },
              Workspace: { kind: 'relation' as const, relation: 'Workspace' },
            },
          },
        },
      }
      const provider = localProvider(storage, 'runtime-test')
      const schema = TR.Data.Schema(definition, providerConnection(provider, 'WordFlowerData', definition))
      await TR.Data.Settle(schema)
      const workspace = schema.query({ entity: 'Workspace', filters: [] })[0] as Record<string, unknown>
      Expect(workspace['Documents'] as unknown[]).toHaveLength(1)
      TR.Data.Create(schema, 'Document', {
        Title: TR.Value('Second'),
        Workspace: TR.Value(workspace),
      })
      await TR.Data.Settle(schema)
      const documents = schema.query({ entity: 'Document', filters: [] }) as Array<Record<string, unknown>>
      Expect(documents.map(document => document['Id'])).toEqual(['Document-4', 'Document-7'])
      Expect(documents[1]?.['Final']).toBe(false)
      Expect(values.has('runtime-test:WordFlowerData')).toBe(true)
    },
  )
})

function relationshipDefinition(name: string): TaoDataSchemaDefinition {
  return {
    name,
    entities: {
      Workspace: { collection: 'Workspaces', fields: { Name: { kind: 'text' } } },
      Task: {
        collection: 'Tasks',
        fields: {
          Title: { kind: 'text' },
          Workspace: { kind: 'relation', relation: 'Workspace' },
        },
      },
    },
  }
}

function memoryConnection(initial?: string): TaoDataConnection {
  return testDataConnection(initial)
}

function localProvider(
  storage: TaoKeyValueStorage,
  keyPrefix = 'tao-data',
): TaoDataProvider {
  return {
    connect: ({ storageKey }) => ({
      load: async () => (await storage.getItem(`${keyPrefix}:${storageKey}`)) ?? undefined,
      save: async value => {
        await storage.setItem(`${keyPrefix}:${storageKey}`, value)
      },
    }),
  }
}

function providerConnection(
  provider: TaoDataProvider,
  storageKey: string,
  schema: TaoDataSchemaDefinition = noteDefinition,
): TaoDataConnection {
  const context: TaoDataProviderContext = Object.freeze({
    configuration: Object.freeze({}),
    schema,
    storageKey,
  })
  return provider.connect(context)
}

function persistedNotes(title: string): string {
  return JSON.stringify({
    formatVersion: 1,
    schemaVersion: 1,
    nextId: 2,
    rows: {
      Note: [{ Id: 'Note-1', Title: title, Done: false, CreatedAt: 1 }],
    },
  })
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

class Deferred<T> {
  readonly promise: Promise<T>
  private rejectPromise!: (error: unknown) => void
  private resolvePromise!: (value: T) => void

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  resolve(value: T extends void ? never : T): void
  resolve(): void
  resolve(value?: T): void {
    this.resolvePromise(value as T)
  }

  reject(error: unknown): void {
    this.rejectPromise(error)
  }
}
