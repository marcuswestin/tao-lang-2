import { Repo } from '@shared'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import type { BackendModule, BookBackend, BookBackendResult, BookRecord } from './syntax2-app-contracts'

// Keep app-owned source out of the runtime package's TypeScript graph. The focused Bun test process
// loads the real app module through its own app-local tsconfig mappings.
const { BookBackend }: BackendModule = await import(Repo.resolvePath('Apps/Syntax2/library/BookBackend.ts'))

const bookFixture = (id: string, title = id, authorID = 'author-a') => ({
  ID: id,
  Title: title,
  Note: `Note ${title}`,
  AuthorID: authorID,
})

const value = <T>(result: BookBackendResult<T>): T => {
  Expect(result.ok).toBe(true)
  return (result as { ok: true; value: T }).value
}

const errorOf = <T>(result: BookBackendResult<T>) => (result.ok ? undefined : result.error)

const fetchEveryPage = async (backend: BookBackend, maximum: number): Promise<BookRecord[]> => {
  const books: BookRecord[] = []
  let continuation: object | null = null
  do {
    const page: { Books: readonly BookRecord[]; Continuation: object | null } = value(
      await backend.fetchPage({ Maximum: maximum, Continuation: continuation }),
    )
    books.push(...page.Books)
    continuation = page.Continuation
  } while (continuation)
  return books
}

Describe('Syntax2 app-owned book backend', () => {
  Test('starts available and empty, and keeps each backend instance isolated', async () => {
    const empty = new BookBackend()
    const seeded = new BookBackend()
    seeded.seedServer([bookFixture('only-seeded')])

    const emptyPage = value(await empty.fetchPage({ Maximum: 40 }))
    Expect(emptyPage).toEqual({ Books: [], Continuation: null })
    Expect(empty.observeRevision('only-seeded', 'user-a')).toBeNull()
    Expect((await fetchEveryPage(seeded, 40)).map(book => book.ID)).toEqual(['only-seeded'])
    Expect(empty.acceptedUploads()).toEqual([])
  })

  Test('fetches more than eighty rows in bounded stable unique-ID pages', async () => {
    const backend = new BookBackend()
    backend.seedServer(
      Array.from({ length: 83 }, (_, index) => bookFixture(`book-${String(82 - index).padStart(3, '0')}`)),
    )

    const first = value(await backend.fetchPage({ Maximum: 40 }))
    Expect(first.Books).toHaveLength(40)
    Expect(first.Books[0]?.ID).toBe('book-000')
    Expect(first.Books[39]?.ID).toBe('book-039')
    Expect(backend.observeRevision('book-040', 'user-a')).toBeNull()
    const second = value(await backend.fetchPage({ Maximum: 40, Continuation: first.Continuation }))
    Expect(second.Books).toHaveLength(40)
    Expect(second.Books[0]?.ID).toBe('book-040')
    Expect(second.Books[39]?.ID).toBe('book-079')
    const third = value(await backend.fetchPage({ Maximum: 40, Continuation: second.Continuation }))
    Expect(third.Books.map(book => book.ID)).toEqual(['book-080', 'book-081', 'book-082'])
    Expect(third.Continuation).toBeNull()
    Expect(first.Books.every((book, index) => book.ID === `book-${String(index).padStart(3, '0')}`)).toBe(true)
    Expect((await backend.fetchPage({ Maximum: 41 })).ok).toBe(false)
  })

  Test('rejects query-mismatched, server-stale, and foreign continuation tokens', async () => {
    const backend = new BookBackend()
    const foreign = new BookBackend()
    backend.seedServer([bookFixture('a'), bookFixture('b'), bookFixture('c', 'Other', 'author-b')])
    foreign.seedServer([bookFixture('a'), bookFixture('b'), bookFixture('c', 'Other', 'author-b')])
    const first = value(await backend.fetchPage({ Maximum: 1, Query: { AuthorID: 'author-a' } }))
    Expect(first.Continuation).not.toBeNull()
    Expect((await backend.fetchPage({ Maximum: 2, Query: { AuthorID: 'author-b' } })).ok).toBe(true)
    Expect(
      (await backend.fetchPage({ Maximum: 1, Query: { AuthorID: 'author-b' }, Continuation: first.Continuation })).ok,
    )
      .toBe(false)
    Expect((await foreign.fetchPage({ Maximum: 1, Continuation: first.Continuation })).ok).toBe(false)
    value(backend.setServerRevision('a', 2))
    Expect(
      (await backend.fetchPage({ Maximum: 1, Query: { AuthorID: 'author-a' }, Continuation: first.Continuation })).ok,
    )
      .toBe(false)

    const optionalFilter = new BookBackend()
    optionalFilter.seedServer([
      bookFixture('has-empty-author', 'Empty author', ''),
      { ID: 'has-no-author', Title: 'No author', Note: 'No author note' },
    ])
    const unfiltered = value(await optionalFilter.fetchPage({ Maximum: 1 }))
    const explicitEmpty = value(await optionalFilter.fetchPage({ Maximum: 40, Query: { AuthorID: '' } }))
    Expect(explicitEmpty.Books.map(book => book.ID)).toEqual(['has-empty-author'])
    Expect(
      (await optionalFilter.fetchPage({ Maximum: 1, Query: { AuthorID: '' }, Continuation: unfiltered.Continuation }))
        .ok,
    )
      .toBe(false)
  })

  Test('rejects permission-denied and injected write batches without changing server, cache, or cursors', async () => {
    const backend = new BookBackend()
    backend.seedServer([bookFixture('a', 'Original'), bookFixture('b', 'Second')])
    const first = value(await backend.fetchPage({ Maximum: 1 }))
    const before = backend.observeRevision('a', 'user-a')!
    const beforePermissionFile = value(backend.createTemporaryPDF('a'))
    const beforePermissionFailure = value(backend.readTemporaryFile(beforePermissionFile))

    backend.setWritePermission(false)
    Expect(errorOf(backend.upsertBooks([bookFixture('a', 'Denied edit'), bookFixture('new')]))?.kind)
      .toBe('permission-denied')
    Expect(backend.observeRevision('a', 'user-a')).toEqual(before)
    Expect(backend.observeRevision('new', 'user-a')).toBeNull()
    const afterPermissionFailure = value(backend.createTemporaryPDF('a'))
    Expect(value(backend.readTemporaryFile(afterPermissionFailure))).toEqual(beforePermissionFailure)
    value(backend.deleteTemporaryFile(afterPermissionFailure))
    value(backend.deleteTemporaryFile(beforePermissionFile))
    backend.setWritePermission(true)
    Expect(value(await backend.fetchPage({ Maximum: 1, Continuation: first.Continuation })).Books[0]?.ID).toBe('b')

    const secondCursor = value(await backend.fetchPage({ Maximum: 1 }))
    const beforeInjected = backend.observeRevision('a', 'user-a')!
    const beforeInjectedFile = value(backend.createTemporaryPDF('a'))
    const beforeInjectedFailure = value(backend.readTemporaryFile(beforeInjectedFile))
    backend.failNext('write', 'write unavailable')
    Expect(errorOf(backend.upsertBooks([bookFixture('a', 'Failed edit'), bookFixture('new')]))?.message)
      .toBe('write unavailable')
    Expect(backend.observeRevision('a', 'user-a')).toEqual(beforeInjected)
    Expect(backend.observeRevision('new', 'user-a')).toBeNull()
    const afterInjectedFailure = value(backend.createTemporaryPDF('a'))
    Expect(value(backend.readTemporaryFile(afterInjectedFailure))).toEqual(beforeInjectedFailure)
    value(backend.deleteTemporaryFile(afterInjectedFailure))
    value(backend.deleteTemporaryFile(beforeInjectedFile))
    Expect(value(await backend.fetchPage({ Maximum: 1, Continuation: secondCursor.Continuation })).Books[0]?.ID).toBe(
      'b',
    )
    Expect((await fetchEveryPage(backend, 40)).map(book => [book.ID, book.Title])).toEqual([
      ['a', 'Original'],
      ['b', 'Second'],
    ])
    Expect(errorOf(backend.upsertBooks([bookFixture('dup'), bookFixture('dup')]))?.kind).toBe('invalid-request')
  })

  Test(
    'upserts local books with default fields, revision changes, retained files, and preserved old tokens',
    async () => {
      const backend = new BookBackend()
      backend.seedServer([bookFixture('server-only', 'Unloaded')])
      value(backend.upsertBooks([bookFixture('local', 'A (Book) \\ path')]))
      const original = backend.observeRevision('local', 'user-a')!
      Expect(original.Revision).toBe(1)
      Expect(original.Unseen).toBe(true)
      Expect(backend.observeRevision('local', 'user-a') && backend.observeRevision('local', 'user-a')!.Revision).toBe(1)
      Expect(
        value(await backend.fetchPage({ Maximum: 40, Query: { AuthorID: 'author-a' } })).Books
          .some(book => book.ID === 'server-only'),
      ).toBe(true)
      Expect(backend.observeRevision('local', 'user-a')?.Unseen).toBe(true)

      value(backend.markSeen(original))
      const file = value(backend.createTemporaryPDF('local'))
      const originalFileBytes = value(backend.readTemporaryFile(file))
      value(backend.upsertBooks([bookFixture('local', 'A (Book) \\ path')]))
      Expect(backend.observeRevision('local', 'user-a')?.Revision).toBe(1)
      Expect(backend.observeRevision('local', 'user-a')?.Unseen).toBe(false)

      value(backend.upsertBooks([{ ...bookFixture('local', 'Changed'), LoanedOut: true }]))
      const loaned = backend.observeRevision('local', 'user-a')!
      Expect(loaned.Revision).toBe(2)
      Expect(loaned.Unseen).toBe(true)
      Expect(value(await backend.fetchPage({ Maximum: 40 })).Books.find(book => book.ID === 'local')?.LoanedOut).toBe(
        true,
      )
      value(backend.markSeen(original))
      Expect(backend.observeRevision('local', 'user-a')?.Unseen).toBe(true)
      Expect(value(backend.readTemporaryFile(file))).toEqual(originalFileBytes)
      Expect(value(backend.uploadFile(file)).Bytes).toEqual(originalFileBytes)
      Expect(backend.acceptedUploads()).toHaveLength(1)

      value(backend.upsertBooks([{ ...bookFixture('local', 'Changed'), LoanedOut: false }]))
      Expect(backend.observeRevision('local', 'user-a')?.Revision).toBe(3)
      value(backend.upsertBooks([{ ...bookFixture('local', 'Changed'), AuthorID: 'author-b', LoanedOut: false }]))
      Expect(backend.observeRevision('local', 'user-a')?.Revision).toBe(4)
      value(backend.upsertBooks([{ ...bookFixture('local', 'Changed'), AuthorID: 'author-b', Note: 'Changed note' }]))
      Expect(backend.observeRevision('local', 'user-a')?.Revision).toBe(5)
      const allBooks = await fetchEveryPage(backend, 40)
      Expect(allBooks.map(book => book.ID)).toEqual(['local', 'server-only'])
      Expect(allBooks[0]).toMatchObject({ AuthorID: 'author-b', LoanedOut: false, Note: 'Changed note' })
      value(backend.deleteTemporaryFile(file))
    },
  )

  Test('keeps an unchanged page cursor and rejects batches whose revision cannot advance safely', async () => {
    const backend = new BookBackend()
    backend.seedServer([bookFixture('a', 'Original'), bookFixture('b', 'Second')])
    const first = value(await backend.fetchPage({ Maximum: 1 }))
    value(backend.upsertBooks([bookFixture('a', 'Original')]))
    Expect(value(await backend.fetchPage({ Maximum: 1, Continuation: first.Continuation })).Books[0]?.ID).toBe('b')

    value(backend.setServerRevision('a', Number.MAX_SAFE_INTEGER))
    await fetchEveryPage(backend, 40)
    const before = backend.observeRevision('a', 'user-a')!
    Expect(errorOf(backend.upsertBooks([bookFixture('a', 'Cannot advance'), bookFixture('new')]))?.kind)
      .toBe('invalid-request')
    Expect(backend.observeRevision('a', 'user-a')).toEqual(before)
    Expect(backend.observeRevision('new', 'user-a')).toBeNull()
    Expect((await fetchEveryPage(backend, 40)).map(book => [book.ID, book.Title])).toEqual([
      ['a', 'Original'],
      ['b', 'Second'],
    ])
  })

  Test('rejects unsupported PDF text without creating an owned file or upload', () => {
    const backend = new BookBackend()
    value(backend.upsertBooks([
      bookFixture('ascii', 'ASCII title'),
      bookFixture('unicode', 'Café title'),
      { ...bookFixture('control', 'Control title'), Note: 'line\nbreak' },
    ]))

    Expect(errorOf(backend.createTemporaryPDF('unicode'))?.kind).toBe('invalid-request')
    Expect(errorOf(backend.createTemporaryPDF('control'))?.kind).toBe('invalid-request')
    Expect(backend.acceptedUploads()).toEqual([])
    const asciiFile = value(backend.createTemporaryPDF('ascii'))
    Expect(value(backend.uploadFile(asciiFile)).FileID).toBe('book-export-1')
    Expect(backend.acceptedUploads()).toHaveLength(1)
    value(backend.deleteTemporaryFile(asciiFile))
  })

  Test('cancellation and a server revision race leave cache and cursor state unadvanced', async () => {
    const backend = new BookBackend()
    backend.seedServer([bookFixture('a'), bookFixture('b')])
    const atCommit = Deferred<void>()
    const gate = Deferred<void>()
    backend.setBeforePageCommit(async () => {
      atCommit.resolve()
      await gate.promise
    })
    const abort = new AbortController()
    const pending = backend.fetchPage({ Maximum: 1, Signal: abort.signal })
    await atCommit.promise
    abort.abort()
    gate.resolve()
    const cancelled = await pending
    Expect(cancelled.ok).toBe(false)
    Expect(backend.observeRevision('a', 'user-a')).toBeNull()

    const revisionAtCommit = Deferred<void>()
    const revisionGate = Deferred<void>()
    backend.setBeforePageCommit(async () => {
      revisionAtCommit.resolve()
      await revisionGate.promise
    })
    const racing = backend.fetchPage({ Maximum: 1 })
    await revisionAtCommit.promise
    value(backend.setServerRevision('a', 2))
    revisionGate.resolve()
    Expect((await racing).ok).toBe(false)
    Expect(backend.observeRevision('a', 'user-a')).toBeNull()
    backend.setBeforePageCommit()
    Expect((await fetchEveryPage(backend, 1)).map(book => book.ID)).toEqual(['a', 'b'])
  })

  Test('observes cached revisions purely and acknowledges only the exact user-scoped revision', async () => {
    const backend = new BookBackend()
    backend.seedServer([bookFixture('a')])
    Expect(backend.observeRevision('a', 'user-a')).toBeNull()
    await fetchEveryPage(backend, 40)
    const firstObservation = backend.observeRevision('a', 'user-a')!
    const otherUser = backend.observeRevision('a', 'user-b')!
    Expect(firstObservation.Unseen).toBe(true)
    Expect(backend.observeRevision('a', 'user-a')).toEqual(firstObservation)
    Expect(otherUser.UserScope).toBe('user-b')
    value(backend.markSeen(firstObservation))
    Expect(backend.observeRevision('a', 'user-a')?.Unseen).toBe(false)
    Expect(backend.observeRevision('a', 'user-b')?.Unseen).toBe(true)

    const beforeRevision = backend.observeRevision('a', 'user-a')!
    value(backend.setServerRevision('a', 2))
    Expect(backend.markSeen(beforeRevision).ok).toBe(true)
    await fetchEveryPage(backend, 40)
    const newer = backend.observeRevision('a', 'user-a')!
    Expect(newer.Revision).toBe(2)
    Expect(newer.Unseen).toBe(true)
    backend.setWritePermission(false)
    const beforeDeniedWrite = backend.observeRevision('a', 'user-a')!
    Expect(errorOf(backend.markSeen(newer))?.kind).toBe('permission-denied')
    Expect(backend.observeRevision('a', 'user-a')).toEqual(beforeDeniedWrite)
    backend.setWritePermission(true)
    backend.failNext('write', 'write unavailable')
    const beforeFailedWrite = backend.observeRevision('a', 'user-a')!
    Expect(errorOf(backend.markSeen(newer))?.message).toBe('write unavailable')
    Expect(backend.observeRevision('a', 'user-a')).toEqual(beforeFailedWrite)
    value(backend.markSeen(newer))
    Expect(backend.observeRevision('a', 'user-a')?.Unseen).toBe(false)

    backend.seedServer([bookFixture('a', 'Reseeded book')])
    Expect(errorOf(backend.markSeen(newer))?.kind).toBe('invalid-token')
    await fetchEveryPage(backend, 40)
    const reseeded = backend.observeRevision('a', 'user-a')!
    Expect(reseeded.Revision).toBe(1)
    Expect(reseeded.Unseen).toBe(true)

    backend.seedServer([bookFixture('a\u0000b', 'Composite key A'), bookFixture('a', 'Composite key B')])
    await fetchEveryPage(backend, 40)
    value(backend.markSeen(backend.observeRevision('a\u0000b', 'c')!))
    Expect(backend.observeRevision('a', 'b\u0000c')?.Unseen).toBe(true)
  })

  Test('keeps export bytes owned through upload and retryable cleanup failures', async () => {
    const backend = new BookBackend()
    backend.seedServer([bookFixture('a', 'A (Book) \\ path')])
    const foreign = new BookBackend()

    backend.failNext('acquisition', '')
    Expect(errorOf(await backend.fetchPage({ Maximum: 40 }))?.message).toBe('')
    backend.failNext('acquisition', 'offline')
    Expect(errorOf(await backend.fetchPage({ Maximum: 40 }))?.message).toBe('offline')
    await fetchEveryPage(backend, 40)
    backend.failNext('export', 'export unavailable')
    Expect(errorOf(backend.createTemporaryPDF('a'))?.message).toBe('export unavailable')
    const file = value(backend.createTemporaryPDF('a'))
    const bytes = value(backend.readTemporaryFile(file))
    const pdf = new TextDecoder().decode(bytes)
    Expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
    Expect(pdf).toContain('(Title: A \\(Book\\) \\\\ path) Tj')
    const startXref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)?.[1])
    Expect(pdf.slice(startXref, startXref + 5)).toBe('xref\n')
    const xrefLines = pdf.slice(startXref).split('\n')
    Expect(xrefLines[1]).toBe('0 6')
    for (let objectNumber = 1; objectNumber <= 5; objectNumber += 1) {
      const objectOffset = Number(xrefLines[objectNumber + 2]?.slice(0, 10))
      Expect(pdf.slice(objectOffset).startsWith(`${objectNumber} 0 obj\n`)).toBe(true)
    }
    const streamHeader = /5 0 obj\n<< \/Length (\d+) >>\nstream\n/.exec(pdf)!
    const streamStart = streamHeader.index + streamHeader[0].length
    const streamLength = Number(streamHeader[1])
    Expect(pdf.slice(streamStart + streamLength, streamStart + streamLength + 9)).toBe('endstream')
    Expect(errorOf(foreign.readTemporaryFile(file))?.kind).toBe('invalid-token')
    Expect(errorOf(foreign.uploadFile(file))?.kind).toBe('invalid-token')
    Expect(errorOf(foreign.deleteTemporaryFile(file))?.kind).toBe('invalid-token')
    Expect(foreign.acceptedUploads()).toEqual([])
    Expect(value(backend.readTemporaryFile(file))).toEqual(bytes)

    backend.failNext('upload', 'upload unavailable')
    Expect(errorOf(backend.uploadFile(file))?.message).toBe('upload unavailable')
    Expect(backend.acceptedUploads()).toEqual([])
    const accepted = value(backend.uploadFile(file))
    Expect(accepted.Bytes).toEqual(bytes)
    accepted.Bytes[0] = 0
    Expect(backend.acceptedUploads()[0]?.Bytes).toEqual(bytes)
    const acceptedSnapshot = backend.acceptedUploads()[0]
    Expect(acceptedSnapshot).toBeDefined()
    acceptedSnapshot!.Bytes[1] = 0
    Expect(backend.acceptedUploads()[0]?.Bytes).toEqual(bytes)
    const readCopy = value(backend.readTemporaryFile(file))
    readCopy[0] = 0
    Expect(value(backend.readTemporaryFile(file))).toEqual(bytes)

    backend.failNext('cleanup', 'cleanup unavailable')
    Expect(errorOf(backend.deleteTemporaryFile(file))?.message).toBe('cleanup unavailable')
    Expect(value(backend.readTemporaryFile(file))).toEqual(bytes)
    value(backend.deleteTemporaryFile(file))
    Expect(errorOf(backend.readTemporaryFile(file))?.kind).toBe('invalid-token')
    Expect(errorOf(backend.uploadFile(file))?.kind).toBe('invalid-token')
    Expect(errorOf(backend.deleteTemporaryFile(file))?.kind).toBe('invalid-token')
    Expect(backend.acceptedUploads()[0]?.Bytes).toEqual(bytes)
  })
})
