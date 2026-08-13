import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoDataProvider, TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'

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
  Test('isolates in-memory envelopes by storage key', async () => {
    const provider = TR.Data.MemoryProvider()

    await provider.save('first-schema', 'first')
    await provider.save('second-schema', 'second')

    Expect(await provider.load('first-schema')).toBe('first')
    Expect(await provider.load('second-schema')).toBe('second')
    Expect(await provider.load('missing-schema')).toBeUndefined()
  })

  Test('rejects schema fields that collide with the generated entity identifier', () => {
    Expect(() =>
      TR.Data.Schema({
        name: 'ReservedFields',
        entities: {
          Entry: { collection: 'Entries', fields: { Id: { kind: 'text' } } },
        },
      }, TR.Data.MemoryProvider())
    ).toThrow("Entity 'Entry' cannot declare reserved field 'Id'.")
  })

  Test('surfaces an unbound-provider error when schema construction has no provider source', async () => {
    const schema = TR.Data.Schema(noteDefinition)
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows.Error).toContain("Data schema 'RuntimeNotes' has no bound provider.")
  })

  Test('binds Memory synchronously and preserves the store across repeated app renders', () => {
    const schema = TR.Data.Schema(noteDefinition)
    TR.Data.Bind(schema, 'memory')
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Bound') })
    const revisionBeforeRepeat = schema.snapshot()

    TR.Data.Bind(schema, 'memory')

    Expect(schema.snapshot()).toBe(revisionBeforeRepeat)
    Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(1)
  })

  Test('keeps the fresh test Memory provider when app binding runs during a check', () => {
    const schema = TR.Data.Schema(noteDefinition, TR.Data.MemoryProvider())
    try {
      TR.Data.beginTest()
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Isolated') })

      TR.Data.Bind(schema, 'local')

      Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(1)
      Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Loading: boolean }).Loading).toBe(false)
    } finally {
      TR.Data.endTest()
    }
  })

  Test('applies only declared defaults and creates stable live entity handles', () => {
    const schema = TR.Data.Schema(noteDefinition, TR.Data.MemoryProvider())
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
    }, TR.Data.MemoryProvider())
    const before = Date.now()

    TR.Data.Create(schema, 'Entry', {})

    const entry = schema.query({ entity: 'Entry', filters: [] })[0] as Record<string, unknown>
    Expect(entry['Label']).toBe('now')
    Expect(typeof entry['CreatedAt']).toBe('number')
    Expect(entry['CreatedAt'] as number).toBeGreaterThanOrEqual(before)
  })

  Test('applies the now clock separately for every create while preserving live handle identity', () => {
    const schema = TR.Data.Schema(noteDefinition, TR.Data.MemoryProvider())
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
    const schema = TR.Data.Schema(noteDefinition, TR.Data.MemoryProvider())
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

  Test('persists the versioned id counter and reloads without identifier collisions', async () => {
    const values = new Map<string, string>()
    const storage = mapStorage(values)
    const provider = TR.Data.LocalProvider(storage, 'persisted-id-test')
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
    const provider: TaoDataProvider = {
      name: 'Controlled',
      load: () => undefined,
      save: (_key, value) => {
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
    Expect(rows.Error).toContain('Could not save local data: disk full')
  })

  Test('recovers from a failed save when a newer queued snapshot saves successfully', async () => {
    let saveCount = 0
    let durable = ''
    const provider: TaoDataProvider = {
      name: 'TransientFailure',
      load: () => undefined,
      save: (_key, value) => {
        saveCount += 1
        if (saveCount === 1) {
          throw new Error('temporary outage')
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
    const provider = TR.Data.MemoryProvider('{"formatVersion":1,"schemaVersion":1,"nextId":2,"rows":{}}')
    const schema = TR.Data.Schema(noteDefinition, provider)
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows).toHaveLength(0)
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
    const schema = TR.Data.Schema(noteDefinition, TR.Data.MemoryProvider(duplicateRows))
    await TR.Data.Settle(schema)

    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows).toHaveLength(0)
    Expect(rows.Error).toContain("Persisted entity 'Note' contains duplicate Id values.")
  })

  Test('ignores a stale async load after provider reconfiguration', async () => {
    const stale = new Deferred<string | undefined>()
    const staleProvider: TaoDataProvider = {
      name: 'Stale',
      load: () => stale.promise,
      save: () => {},
    }
    const schema = TR.Data.Schema(noteDefinition, staleProvider)
    schema.configure(TR.Data.MemoryProvider())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Current') })
    stale.resolve(persistedNotes('Stale'))
    await flushMicrotasks()

    const rows = schema.query({ entity: 'Note', filters: [] }) as Array<Record<string, unknown>>
    Expect(rows.map(row => row['Title'])).toEqual(['Current'])
  })

  Test('invalidates live handles when the schema changes provider generations', () => {
    const schema = TR.Data.Schema(noteDefinition, TR.Data.MemoryProvider())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Old store') })
    const oldHandle = schema.query({ entity: 'Note', filters: [] })[0]

    schema.configure(TR.Data.MemoryProvider())
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
    const provider: TaoDataProvider = {
      name: 'CountingMemory',
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
    }, TR.Data.MemoryProvider())
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
    const primary = TR.Data.Schema(relationshipDefinition('PrimaryRelationships'), TR.Data.MemoryProvider())
    const foreign = TR.Data.Schema(relationshipDefinition('ForeignRelationships'), TR.Data.MemoryProvider())
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

    primary.configure(TR.Data.MemoryProvider())
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
    const schema = TR.Data.Schema(definition, TR.Data.MemoryProvider())
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

function mapStorage(values: Map<string, string>): {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
} {
  return {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value)
    },
  }
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
