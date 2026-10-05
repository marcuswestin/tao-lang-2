import TR from '@runtime/TR'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runActionResult } from '../TaoRuntime-src/TR-action-transactions'
import type { TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'
import { testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import { TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import type { IOModule, ProviderModule } from './syntax2-app-contracts'

// Resolve these app-owned modules at test runtime so the runtime package's typecheck stays scoped.
const library = Repo.resolvePath('Apps/Syntax2/library')
const {
  CreateTemporaryPDF,
  DeleteTemporaryFile,
  LoadAfter,
  LoadedItems,
  MarkSeen,
  ObservedRevision,
  Refresh,
  UploadFile,
}: IOModule = await import(FS.resolvePath('BookIO.ts', library))
const { BookProvider, bookStoreSession }: ProviderModule = await import(FS.resolvePath('BookStoreProvider.ts', library))

const definition: TaoDataSchemaDefinition = {
  name: 'BookIOProof',
  schemaVersion: 1,
  entities: {
    Person: { collection: 'People', fields: { Name: { kind: 'text' } } },
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
const plan = { entity: 'Book', filters: [], pageSize: 40 }

async function connect(count = 1) {
  const connection = BookProvider().connect({ configuration: {}, schema: definition, storageKey: 'BookIOProof' })
  const session = bookStoreSession(connection)
  session.backend.seedServer(Array.from({ length: count }, (_, index) => ({
    ID: `book-${String(index + 1).padStart(3, '0')}`,
    Title: `Book ${index + 1}`,
    Note: '',
  })))
  const schema = TR.Data.Schema(definition, connection)
  await schema.settle()
  schema.activateQuery(plan)
  await schema.settle()
  const rows = () => schema.query(plan) as never[]
  return { schema, session, rows, book: rows()[0]! }
}

Describe('Syntax2 app I/O adapters', () => {
  Test('exports actual bytes and drains lexical cleanup on success and upload failure', async () => {
    const { book, session } = await connect()
    await runActionResult('ExportBook', [], () =>
      TR.ActionScope(() => {
        const file = CreateTemporaryPDF(book)
        TR.Defer(() => DeleteTemporaryFile(file))
        UploadFile(file)
        Expect(() => UploadFile({ ...file })).toThrow('original owned temporary file')
      }))
    const uploads = session.backend.acceptedUploads()
    Expect(uploads).toHaveLength(1)
    Expect(new TextDecoder().decode(uploads[0]!.Bytes)).toContain('%PDF-1.4')

    session.backend.failNext('upload', 'Upload unavailable')
    let failedFile: ReturnType<typeof CreateTemporaryPDF> | undefined
    await Expect(
      runActionResult('ExportBook', [], () =>
        TR.ActionScope(() => {
          failedFile = CreateTemporaryPDF(book)
          TR.Defer(() => DeleteTemporaryFile(failedFile!))
          UploadFile(failedFile)
        })),
    ).rejects.toBeInstanceOf(TaoActionFailure)
    Expect(() => UploadFile(failedFile!)).toThrow('original owned temporary file')
    Expect(session.backend.acceptedUploads()).toHaveLength(1)
  })

  Test('cleanup remains retryable after failure and after the datasource generation closes', async () => {
    const { book, session, schema } = await connect()
    const file = CreateTemporaryPDF(book)
    UploadFile(file)
    session.backend.failNext('cleanup', 'Cleanup unavailable')
    Expect(() => DeleteTemporaryFile(file)).toThrow('Cleanup unavailable')
    Expect(session.backend.acceptedUploads()).toHaveLength(1)
    schema.configure(testDataConnection())
    await schema.settle()
    Expect(() => UploadFile(file)).toThrow('inactive provider generation')
    DeleteTemporaryFile(file)
    Expect(() => DeleteTemporaryFile(file)).toThrow('original owned temporary file')
  })

  Test('acknowledges the displayed revision without acknowledging a later refresh', async () => {
    const { book, session, schema, rows } = await connect()
    const original = ObservedRevision(book)
    Expect(original.Unseen).toBe(true)
    let notifications = 0
    const stop = schema.subscribe(() => notifications++)
    MarkSeen(original)
    Expect(notifications).toBe(1)
    Expect(ObservedRevision(book).Unseen).toBe(false)
    Expect(() => MarkSeen({ ...original })).toThrow('original displayed book revision')
    session.backend.upsertBooks([{ ID: 'book-001', Title: 'Changed', Note: '' }])
    await Refresh(rows())
    Expect(rows()[0]).toBe(book)
    MarkSeen(original)
    const refreshed = ObservedRevision(book)
    Expect(refreshed.RevisionID).not.toBe(original.RevisionID)
    Expect(refreshed.Unseen).toBe(true)
    MarkSeen(refreshed)
    Expect(ObservedRevision(book).Unseen).toBe(false)
    stop()
  })

  Test('continues the owned window and preserves acquired rows on a failed continuation', async () => {
    const { rows, session, schema } = await connect(83)
    const first = rows()
    Expect(LoadedItems(first)).toBe(first)
    Expect(first).toHaveLength(40)
    session.backend.failNext('acquisition', 'Network unavailable')
    await Expect(LoadAfter(first)).rejects.toThrow('Network unavailable')
    Expect(rows()).toHaveLength(40)
    await LoadAfter(rows())
    await schema.settle()
    Expect(rows()).toHaveLength(80)
    await LoadAfter(rows())
    await schema.settle()
    Expect(rows()).toHaveLength(83)
    Expect(() => LoadedItems([...rows()])).toThrow('live query result')
  })
})
