import TR from '@tao/runtime'
type TaoDataConnection = TR.DataConnection
type TaoDataConnectionObserver = TR.DataConnectionObserver
type TaoDataProvider = TR.DataProvider
type TaoDataProviderContext = TR.DataProviderContext
type TaoQueryDescriptor = TR.QueryDescriptor
import { BookBackend, type BookInput, type BookPage, type BookRecord } from './BookBackend'

export type BookStoreAcquisition = 'first' | 'next' | 'refresh'

export type BookStoreSession = Readonly<{
  backend: BookBackend
  acquire(descriptor: TaoQueryDescriptor, mode: BookStoreAcquisition, signal?: AbortSignal): Promise<BookPage>
}>

type ValidatedQuery = Readonly<{
  authorID?: string
  identity: string
  maximum: number
}>

type ActiveAcquisition = Readonly<{
  controller: AbortController
  promise: Promise<BookPage>
}>

const sessions = new WeakMap<TaoDataConnection, BookStoreSession>()

/** BookProvider binds the Syntax2 BookStore schema to one isolated deterministic backend. */
export function BookProvider(): TaoDataProvider {
  return {
    fills: true,
    connect(context: TaoDataProviderContext): TaoDataConnection {
      const backend = new BookBackend()
      backend.seedServer(Array.from({ length: 83 }, (_, index) => ({
        ID: `book-${String(index + 1).padStart(3, '0')}`,
        Title: `Book ${index + 1}`,
        Note: '',
      })))
      const bookEntity = context.schema.entities['Book']
      if (!bookEntity) {
        return TR.Errors.failInput("BookStore requires a 'Book' entity.")
      }
      const supportedFields = new Set(['Title', 'Note', 'Author', 'LoanedOut'])
      for (const field of Object.keys(bookEntity.fields)) {
        if (!supportedFields.has(field)) {
          TR.Errors.failInput(`BookStore does not support the Book.${field} field.`)
        }
      }
      const empty = TR.Data.NativeSnapshots.empty(context.schema)
      let ownedSnapshot = TR.Data.NativeSnapshots.encode(empty, context.schema)
      let closed = false
      const observers = new Set<TaoDataConnectionObserver>()
      const active = new Set<AbortController>()
      const cursors = new Map<string, object | null>()
      const acquisitions = new Map<string, ActiveAcquisition>()
      const cursorIDs = new WeakMap<object, number>()
      let nextCursorID = 1

      const assertOpen = (signal?: AbortSignal): void => {
        if (closed || context.signal?.aborted || signal?.aborted) {
          TR.Errors.failHost('Book acquisition was cancelled because its datasource connection ended.')
        }
      }

      const publish = (snapshot: string): void => {
        ownedSnapshot = snapshot
        for (const observer of observers) {
          observer.snapshot(ownedSnapshot)
        }
      }

      const validateDescriptor = (descriptor: TaoQueryDescriptor): ValidatedQuery => {
        if (descriptor.entity !== 'Book') {
          TR.Errors.failInput(`BookStore cannot acquire entity '${descriptor.entity}'.`)
        }
        if (
          descriptor.orderBy !== undefined
          && (!['Id', 'ID'].includes(descriptor.orderBy) || descriptor.orderDirection !== 'asc')
        ) {
          TR.Errors.failInput('BookStore supports only ascending ID order.')
        }
        let authorID: string | undefined
        for (const [field, value] of Object.entries(descriptor.where)) {
          if (field !== 'Author' || value === null || typeof value !== 'object') {
            TR.Errors.failInput(`BookStore does not support the '${field}' query filter.`)
          }
          const candidate = (value as Readonly<Record<string, unknown>>)['Id']
          if (typeof candidate !== 'string') {
            return TR.Errors.failInput('BookStore author filters require a text author ID.')
          }
          authorID = candidate
        }
        if (descriptor.limit !== undefined) {
          TR.Errors.failInput('BookStore pagination cannot be combined with a local limit.')
        }
        const maximum = descriptor.pageSize
        if (maximum === undefined || !Number.isInteger(maximum) || maximum < 1 || maximum > 40) {
          return TR.Errors.failInput('BookStore query pageSize must be an integer from 1 through 40.')
        }
        const identity = JSON.stringify([descriptor.entity, authorID ?? null, maximum, 'ID', 'asc'])
        return { ...(authorID === undefined ? {} : { authorID }), identity, maximum }
      }

      const projectBook = (book: BookRecord) => ({
        Id: book.ID,
        Title: book.Title,
        Note: book.Note,
        Author: book.AuthorID ?? null,
        LoanedOut: book.LoanedOut ?? false,
      })

      const session: BookStoreSession = {
        backend,
        acquire(descriptor, mode, signal) {
          assertOpen(signal)
          const query = validateDescriptor(descriptor)
          const previousCursor = cursors.get(query.identity) ?? null
          if (mode === 'next' && previousCursor === null) {
            return Promise.resolve({ Books: [], Continuation: null })
          }
          const cursorID = previousCursor === null
            ? 'start'
            : cursorIDs.get(previousCursor) ?? nextCursorID++
          if (previousCursor !== null && !cursorIDs.has(previousCursor)) {
            cursorIDs.set(previousCursor, Number(cursorID))
          }
          const operationKey = JSON.stringify([query.identity, mode, mode === 'next' ? cursorID : 'start'])
          const existing = acquisitions.get(operationKey)
          if (existing) {
            return existing.promise
          }

          const controller = new AbortController()
          active.add(controller)
          const abort = (): void => controller.abort()
          context.signal?.addEventListener('abort', abort, { once: true })
          signal?.addEventListener('abort', abort, { once: true })
          if (context.signal?.aborted || signal?.aborted) {
            controller.abort()
          }
          const continuation = mode === 'next' ? previousCursor : null
          const promise = (async (): Promise<BookPage> => {
            try {
              assertOpen(signal)
              if (controller.signal.aborted) {
                TR.Errors.failHost('Book acquisition was cancelled.')
              }
              const result = await backend.fetchPage({
                Maximum: query.maximum,
                ...(query.authorID === undefined ? {} : { Query: { AuthorID: query.authorID } }),
                Continuation: continuation,
                Signal: controller.signal,
              })
              assertOpen(signal)
              if (controller.signal.aborted) {
                TR.Errors.failHost('Book acquisition was cancelled.')
              }
              if (!result.ok) {
                return TR.Errors.failHost(result.error.message)
              }

              const stored = TR.Data.NativeSnapshots.decode(ownedSnapshot, context.schema)
              const rows = [...stored.rows['Book']!]
              for (const book of result.value.Books) {
                const projected = projectBook(book)
                const index = rows.findIndex(row => row.Id === projected.Id)
                if (index < 0) {
                  rows.push(projected as (typeof rows)[number])
                } else {
                  rows[index] = { ...rows[index], ...projected }
                }
              }
              const next = { ...stored, rows: { ...stored.rows, Book: rows } }
              const snapshot = TR.Data.NativeSnapshots.encode(next, context.schema)
              cursors.set(query.identity, result.value.Continuation)
              publish(snapshot)
              return result.value
            } finally {
              active.delete(controller)
              context.signal?.removeEventListener('abort', abort)
              signal?.removeEventListener('abort', abort)
            }
          })()
          acquisitions.set(operationKey, { controller, promise })
          void promise.finally(() => {
            if (acquisitions.get(operationKey)?.promise === promise) {
              acquisitions.delete(operationKey)
            }
          }).catch(() => undefined)
          return promise
        },
      }

      const connection: TaoDataConnection = {
        pagedQueries: true,
        fillCacheMs: Infinity,
        load: () => ownedSnapshot,
        fill: async request => {
          await session.acquire(request.descriptor, 'first', context.signal)
        },
        save(snapshot, _intents, writeContext) {
          assertOpen()
          const next = TR.Data.NativeSnapshots.decode(snapshot, context.schema)
          const previous = TR.Data.NativeSnapshots.decode(
            writeContext?.previousSnapshot ?? ownedSnapshot,
            context.schema,
          )
          const nextIDs = new Set(next.rows['Book']!.map(row => row.Id))
          if (previous.rows['Book']!.some(row => !nextIDs.has(row.Id))) {
            TR.Errors.failInput('BookStore does not support deleting books.')
          }
          const records: BookInput[] = next.rows['Book']!.map(row => ({
            ID: row.Id,
            Title: String(row['Title']),
            Note: String(row['Note']),
            ...(row['Author'] === null || row['Author'] === undefined ? {} : { AuthorID: String(row['Author']) }),
            LoanedOut: Boolean(row['LoanedOut']),
          }))
          const result = backend.upsertBooks(records)
          if (!result.ok) {
            TR.Errors.failHost(result.error.message)
          }
          publish(TR.Data.NativeSnapshots.encode(next, context.schema))
        },
        subscribe(observer) {
          observers.add(observer)
          return () => observers.delete(observer)
        },
        close() {
          closed = true
          for (const controller of active) {
            controller.abort()
          }
          observers.clear()
        },
      }
      sessions.set(connection, session)
      return connection
    },
  }
}

/** bookStoreSession returns only the session privately associated with this live connection. */
export function bookStoreSession(connection: TaoDataConnection): BookStoreSession {
  const session = sessions.get(connection)
  if (!session) {
    return TR.Errors.failInput('BookStore operations require a live BookStore datasource connection.')
  }
  return session
}
