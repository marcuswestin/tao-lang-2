import TR from '@tao/runtime'
import { type BookBackendResult, type ObservedBookRevision, type TemporaryBookFile } from './BookBackend'
import { type BookStoreSession, bookStoreSession } from './BookStoreProvider'

type LiveBook = Readonly<{
  Title: string
  Note: string
  Author?: Readonly<{ Name: string }> | null
  LoanedOut: boolean
}>
type Revision = Readonly<{ Book: LiveBook; RevisionID: string; Unseen: boolean }>
type FileToken = Readonly<{ ID: string }>
type EntityContext = ReturnType<typeof TR.Data.NativeEntityContext>

const revisions = new WeakMap<
  Revision,
  Readonly<{
    context: EntityContext
    session: BookStoreSession
    issued: ObservedBookRevision
  }>
>()
const files = new WeakMap<
  FileToken,
  Readonly<{
    book: LiveBook
    context: EntityContext
    session: BookStoreSession
    issued: TemporaryBookFile
  }>
>()
const notices = new WeakMap<TR.DataConnection, Map<string, string>>()
let nextFileID = 1

function bookContext(book: LiveBook): EntityContext {
  const context = TR.Data.NativeEntityContext(book)
  if (context.entity !== 'Book') {
    return TR.Errors.failInput('This operation requires a live BookStore book.')
  }
  bookStoreSession(context.connection)
  return context
}

function checked<Value>(result: BookBackendResult<Value>): Value {
  if (!result.ok) {
    return TR.Fail(TR.Value(result.error.kind), result.error.message)
  }
  return result.value
}

/** Capture precisely the acquired revision displayed to this local app user. No I/O or acknowledgment. */
export function ObservedRevision(book: LiveBook): Revision {
  const context = bookContext(book)
  const session = bookStoreSession(context.connection)
  const issued = session.backend.observeRevision(context.id, 'local-user')
  if (issued === null) {
    return TR.Errors.failInput('The book revision has not been acquired by this datasource.')
  }
  const revision = Object.freeze({
    Book: book,
    RevisionID: `${issued.BookID}:${issued.Revision}`,
    Unseen: issued.Unseen,
  })
  revisions.set(revision, { context, session, issued })
  return revision
}

/** Keep query ownership and every live handle unchanged while exposing the loaded collection. */
export function LoadedItems(window: LiveBook[]): LiveBook[] {
  TR.Data.NativeQueryContext(window)
  return window
}

export function ExportNotice(book: LiveBook): string {
  const context = bookContext(book)
  return notices.get(context.connection)?.get(context.id) ?? ''
}

/** Duration backing is canonical seconds; the native adapter never discards a Tao unit implicitly. */
export function NotifyExport(book: LiveBook, duration: TR.Value<TR.QuantityPayload>): void {
  const context = bookContext(book)
  if (!TR.isQuantityPayload(duration.evaluate().jsValue)) {
    return TR.Errors.failInput('Export completion requires a checked Duration.')
  }
  let messages = notices.get(context.connection)
  if (!messages) {
    messages = new Map()
    notices.set(context.connection, messages)
  }
  messages.set(context.id, `Export completed in ${duration.getJSValue()} seconds.`)
  context.notifyMetadataChanged()
}

export function CreateTemporaryPDF(book: LiveBook): FileToken {
  const context = bookContext(book)
  const session = bookStoreSession(context.connection)
  const issued = checked(session.backend.createTemporaryPDF(context.id))
  const file = Object.freeze({ ID: `book-export-${nextFileID++}` })
  files.set(file, { book, context, session, issued })
  return file
}

function ownedFile(file: FileToken) {
  const ownership = files.get(file)
  if (!ownership) {
    return TR.Errors.failInput('This operation requires the original owned temporary file.')
  }
  return ownership
}

export function UploadFile(file: FileToken): void {
  const ownership = ownedFile(file)
  bookContext(ownership.book)
  checked(ownership.session.backend.uploadFile(ownership.issued))
}

export function DeleteTemporaryFile(file: FileToken): void {
  const ownership = ownedFile(file)
  checked(ownership.session.backend.deleteTemporaryFile(ownership.issued))
  files.delete(file)
}

export function MarkSeen(revision: Revision): void {
  const ownership = revisions.get(revision)
  if (!ownership) {
    return TR.Errors.failInput('This operation requires the original displayed book revision.')
  }
  bookContext(revision.Book)
  checked(ownership.session.backend.markSeen(ownership.issued))
  ownership.context.notifyMetadataChanged()
}

export async function LoadAfter(window: LiveBook[]): Promise<void> {
  const query = TR.Data.NativeQueryContext(window)
  const signal = TR.ActionCancellationSignal()
  await query.run(async (connection, descriptor) => {
    await bookStoreSession(connection).acquire(descriptor, 'next', signal)
  })
}

export async function Refresh(window: LiveBook[]): Promise<void> {
  const query = TR.Data.NativeQueryContext(window)
  const signal = TR.ActionCancellationSignal()
  await query.run(async (connection, descriptor) => {
    await bookStoreSession(connection).acquire(descriptor, 'refresh', signal)
  })
}
