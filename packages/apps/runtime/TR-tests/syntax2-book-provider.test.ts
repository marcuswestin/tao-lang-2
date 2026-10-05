import TR from '@runtime/TR'
import { FS, Repo } from '@shared'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import type { TaoDataConnection, TaoDataSchemaDefinition, TaoQueryDescriptor } from '../TaoRuntime-src/TR-data'
import { testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import { HostEnvironmentError } from '../TaoRuntime-src/TR-errors'
import type { BookInput, ProviderModule } from './syntax2-app-contracts'

// Load the real app modules in the focused test process using the app's local path mappings.
const library = Repo.resolvePath('Apps/Syntax2/library')
const { BookProvider, bookStoreSession }: ProviderModule = await import(FS.resolvePath('BookStoreProvider.ts', library))

const bookDefinition: TaoDataSchemaDefinition = {
  name: 'Syntax2BookStore',
  schemaVersion: 1,
  entities: {
    Person: {
      collection: 'People',
      fields: { Name: { kind: 'text' } },
    },
    Book: {
      collection: 'Books',
      fields: {
        Title: { kind: 'text', required: 'Enter a title' },
        Note: { kind: 'text', defaultValue: '' },
        Author: { kind: 'relation', relation: 'Person', optional: true },
        LoanedOut: { kind: 'boolean', defaultValue: false },
      },
    },
  },
}

type BookSchema = ReturnType<typeof TR.Data.Schema>

const bookPlan = () => ({ entity: 'Book', filters: [], pageSize: 40 })

function connect(): { connection: TaoDataConnection; schema: BookSchema } {
  const connection = BookProvider().connect({
    configuration: {},
    schema: bookDefinition,
    storageKey: 'Syntax2BookStore',
  })
  return { connection, schema: TR.Data.Schema(bookDefinition, connection) }
}

function books(count: number): BookInput[] {
  return Array.from({ length: count }, (_, index) => ({
    ID: `book-${String(index + 1).padStart(3, '0')}`,
    Title: `Book ${index + 1}`,
    Note: '',
  }))
}

async function acquireThroughQuery(
  schema: BookSchema,
  mode: 'first' | 'next' | 'refresh',
): Promise<void> {
  const rows = schema.query(bookPlan())
  await TR.Data.NativeQueryContext(rows).run(async (connection, descriptor) => {
    await bookStoreSession(connection).acquire(descriptor, mode)
  })
}

async function ready(schema: BookSchema): Promise<void> {
  await schema.settle()
}

function snapshotWithBook(bookID: string, title: string): string {
  const snapshot = TR.Data.NativeSnapshots.empty(bookDefinition)
  snapshot.rows['Book']!.push({
    Id: bookID,
    Title: title,
    Note: '',
    Author: null,
    LoanedOut: false,
  })
  return TR.Data.NativeSnapshots.encode(snapshot, bookDefinition)
}

Describe('Syntax2 BookStore runtime provider', () => {
  Test('projects 83 books through bounded pages without truncating accumulated rows', async () => {
    const { schema } = connect()
    await ready(schema)

    schema.activateQuery(bookPlan())
    await ready(schema)
    Expect(schema.query(bookPlan())).toHaveLength(40)
    const first = schema.query(bookPlan())[0] as never
    Expect(TR.Data.Read(first, 'Id')).toBe('book-001')
    Expect(schema.read(first, 'Note')).toBe('')
    Expect(schema.read(first, 'Author')).toBe(null)
    Expect(schema.read(first, 'LoanedOut')).toBe(true)

    await acquireThroughQuery(schema, 'next')
    await ready(schema)
    Expect(schema.query(bookPlan())).toHaveLength(80)
    await acquireThroughQuery(schema, 'next')
    await ready(schema)
    Expect(schema.query(bookPlan())).toHaveLength(83)
    await acquireThroughQuery(schema, 'next')
    Expect(schema.query(bookPlan())).toHaveLength(83)
  })

  Test('refresh updates the same live entity handle', async () => {
    const { connection, schema } = connect()
    const session = bookStoreSession(connection)
    session.backend.seedServer(books(1))
    await ready(schema)
    schema.activateQuery(bookPlan())
    await ready(schema)

    const original = schema.query(bookPlan())[0] as never
    const update = session.backend.upsertBooks([{ ID: 'book-001', Title: 'Revised title', Note: 'New note' }])
    Expect(update.ok).toBe(true)
    await acquireThroughQuery(schema, 'refresh')
    await ready(schema)

    const refreshed = schema.query(bookPlan())[0] as never
    Expect(refreshed).toBe(original)
    Expect(schema.read(refreshed, 'Title')).toBe('Revised title')
  })

  Test('a replaced datasource connection fences an in-flight page from publication', async () => {
    const { connection, schema } = connect()
    const session = bookStoreSession(connection)
    session.backend.seedServer(books(1))
    await ready(schema)

    const started = Deferred<void>()
    const gate = Deferred<void>()
    session.backend.setBeforePageCommit(async () => {
      started.resolve()
      await gate.promise
    })
    const rows = schema.query(bookPlan())
    const operation = TR.Data.NativeQueryContext(rows).run(async (oldConnection, descriptor) => {
      await bookStoreSession(oldConnection).acquire(descriptor, 'first')
    })
    await started.promise
    schema.configure(testDataConnection())
    gate.resolve()

    await Expect(operation).rejects.toBeInstanceOf(HostEnvironmentError)
    await ready(schema)
    Expect(schema.query({ entity: 'Book', filters: [] })).toHaveLength(0)
  })

  Test('denied writes leave the backend unchanged and unsupported deletion is rejected', async () => {
    const { connection, schema } = connect()
    const backend = bookStoreSession(connection).backend
    backend.seedServer([{ ID: 'book-001', Title: 'Original', Note: '' }])
    const previousSnapshot = snapshotWithBook('book-001', 'Original')
    const nextSnapshot = snapshotWithBook('book-001', 'Changed')
    await ready(schema)
    backend.setWritePermission(false)

    await Expect(Promise.resolve().then(() => connection.save(nextSnapshot, [], { previousSnapshot })))
      .rejects.toThrow('cannot write these books')
    const unchanged = await backend.fetchPage({ Maximum: 40 })
    Expect(unchanged.ok && unchanged.value.Books[0]?.Title).toBe('Original')

    const emptySnapshot = TR.Data.NativeSnapshots.encode(
      TR.Data.NativeSnapshots.empty(bookDefinition),
      bookDefinition,
    )
    await Expect(Promise.resolve().then(() => connection.save(emptySnapshot, [], { previousSnapshot })))
      .rejects.toThrow('does not support deleting books')
    const stillUnchanged = await backend.fetchPage({ Maximum: 40 })
    Expect(stillUnchanged.ok && stillUnchanged.value.Books[0]?.Title).toBe('Original')
  })

  Test('fetch failures preserve rows and cursor so a retry continues the same query', async () => {
    const { connection, schema } = connect()
    const backend = bookStoreSession(connection).backend
    backend.seedServer(books(83))
    await ready(schema)
    schema.activateQuery(bookPlan())
    await ready(schema)
    Expect(schema.query(bookPlan())).toHaveLength(40)

    backend.failNext('acquisition', 'Temporary acquisition failure')
    await Expect(acquireThroughQuery(schema, 'next')).rejects.toBeInstanceOf(HostEnvironmentError)
    Expect(schema.query(bookPlan())).toHaveLength(40)

    await acquireThroughQuery(schema, 'next')
    await ready(schema)
    Expect(schema.query(bookPlan())).toHaveLength(80)
  })

  Test('identical concurrent acquisitions join one backend request', async () => {
    const { connection, schema } = connect()
    const session = bookStoreSession(connection)
    session.backend.seedServer(books(1))
    await ready(schema)

    const started = Deferred<void>()
    const gate = Deferred<void>()
    let fetches = 0
    session.backend.setBeforePageCommit(async () => {
      fetches++
      started.resolve()
      await gate.promise
    })
    const descriptor = TR.Data.NativeQueryContext(schema.query(bookPlan())).descriptor
    const first = session.acquire(descriptor, 'first')
    const joined = session.acquire(descriptor, 'first')
    Expect(joined).toBe(first)
    await started.promise
    gate.resolve()
    await Promise.all([first, joined])
    Expect(fetches).toBe(1)
  })

  Test('empty owned queries support terminal continuation and reject foreign ownership', async () => {
    const { connection, schema } = connect()
    bookStoreSession(connection).backend.seedServer([])
    await ready(schema)
    schema.activateQuery(bookPlan())
    await ready(schema)
    const rows = schema.query(bookPlan())
    Expect(rows).toHaveLength(0)
    Expect(TR.Data.NativeQueryContext(rows).connection).toBe(connection)

    await acquireThroughQuery(schema, 'next')
    Expect(() => TR.Data.NativeQueryContext([])).toThrow('live query result')
    Expect(() => TR.Data.NativeEntityContext({ Id: 'reconstructed' })).toThrow('live data item')
    Expect(() => bookStoreSession(testDataConnection())).toThrow('live BookStore datasource connection')
  })

  Test('unsupported query filters and sort orders fail explicitly', async () => {
    const { connection, schema } = connect()
    await ready(schema)
    const session = bookStoreSession(connection)
    const base: TaoQueryDescriptor = {
      entity: 'Book',
      pageSize: 40,
      orderBy: 'Id',
      orderDirection: 'asc',
      where: {},
    }
    await Expect(Promise.resolve().then(() => session.acquire({ ...base, where: { Title: 'Book 1' } }, 'first')))
      .rejects.toThrow("does not support the 'Title' query filter")
    await Expect(
      Promise.resolve().then(() =>
        session.acquire(
          { ...base, orderBy: 'Title', orderDirection: 'desc' },
          'first',
        )
      ),
    ).rejects.toThrow('ascending ID order')
    await Expect(Promise.resolve().then(() => session.acquire({ ...base, limit: 5 }, 'first')))
      .rejects.toThrow('cannot be combined with a local limit')
    await Expect(Promise.resolve().then(() => session.acquire({ ...base, pageSize: undefined }, 'first')))
      .rejects.toThrow('pageSize must be an integer')
  })
})
