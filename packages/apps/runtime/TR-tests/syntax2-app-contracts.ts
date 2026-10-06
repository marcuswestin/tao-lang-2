import type TR from '@runtime/TR'
import type { TaoDataConnection, TaoDataProvider, TaoQueryDescriptor } from '../TaoRuntime-src/TR-data'

// Test-local structural contracts keep opaque app imports outside this package's source graph.
// Implementations and behavior are supplied by the real app modules loaded by each test.
export type BookInput = Readonly<{
  ID: string
  Title: string
  Note: string
  AuthorID?: string
  LoanedOut?: boolean
}>
export type BookRecord = Readonly<BookInput & { LoanedOut: boolean; Revision: number }>
type Failure = Readonly<{ kind: string; message: string }>
export type BookBackendResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: Failure }>
type Page = Readonly<{ Books: readonly BookRecord[]; Continuation: object | null }>
type Revision = Readonly<{ BookID: string; Revision: number; UserScope: string; Unseen: boolean }>
type Upload = Readonly<{ FileID: string; Bytes: Uint8Array }>

export interface BookBackend {
  seedServer(records: readonly BookInput[]): void
  setServerRevision(bookID: string, revision: number): BookBackendResult<BookRecord>
  upsertBooks(records: readonly BookInput[]): BookBackendResult<void>
  failNext(operation: 'acquisition' | 'write' | 'export' | 'upload' | 'cleanup', message: string): void
  setWritePermission(allowed: boolean): void
  setBeforePageCommit(hook?: () => Promise<void>): void
  fetchPage(
    request: Readonly<{
      Maximum: number
      Query?: Readonly<{ AuthorID?: string; Text?: string }>
      Continuation?: object | null
      Signal?: AbortSignal
    }>,
  ): Promise<BookBackendResult<Page>>
  observeRevision(bookID: string, userScope: string): Revision | null
  markSeen(revision: Revision): BookBackendResult<void>
  createTemporaryPDF(bookID: string): BookBackendResult<object>
  readTemporaryFile(file: object): BookBackendResult<Uint8Array>
  uploadFile(file: object): BookBackendResult<Upload>
  deleteTemporaryFile(file: object): BookBackendResult<void>
  acceptedUploads(): readonly Upload[]
}

export type BackendModule = { BookBackend: new() => BookBackend }
export type ProviderModule = {
  BookProvider(): TaoDataProvider
  bookStoreSession(connection: TaoDataConnection): Readonly<{
    backend: BookBackend
    acquire(descriptor: TaoQueryDescriptor, mode: 'first' | 'next' | 'refresh', signal?: AbortSignal): Promise<Page>
  }>
}
type LiveBook = Readonly<{
  Title: string
  Note: string
  Author?: Readonly<{ Name: string }> | null
  LoanedOut: boolean
}>
type FileToken = Readonly<{ ID: string }>
type DisplayedRevision = Readonly<{ Book: LiveBook; RevisionID: string; Unseen: boolean }>
export type IOModule = {
  CreateTemporaryPDF(book: LiveBook): FileToken
  DeleteTemporaryFile(file: FileToken): void
  UploadFile(file: FileToken): void
  ObservedRevision(book: LiveBook): DisplayedRevision
  MarkSeen(revision: DisplayedRevision): void
  LoadedItems(window: LiveBook[]): LiveBook[]
  LoadAfter(window: LiveBook[]): Promise<void>
  Refresh(window: LiveBook[]): Promise<void>
}
export type GroupedRowsModule = {
  GroupedRows(items: readonly unknown[], builders: TR.Capability): readonly Readonly<{
    RowKey: string
    Content: TR.Capability
  }>[]
}
