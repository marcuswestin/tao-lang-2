export type BookRecord = Readonly<{
  ID: string
  Title: string
  Note: string
  AuthorID?: string
  LoanedOut: boolean
  Revision: number
}>

export type BookInput = Readonly<Omit<BookRecord, 'Revision' | 'LoanedOut'> & { LoanedOut?: boolean }>

export type BookQuery = Readonly<{ AuthorID?: string; Text?: string }>

type BookBackendFailure = Readonly<{
  kind: 'cancelled' | 'invalid-request' | 'invalid-token' | 'permission-denied' | 'injected-failure' | 'server-changed'
  message: string
}>

export type BookBackendResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: BookBackendFailure }>

export type BookPage = Readonly<{
  Books: readonly BookRecord[]
  Continuation: object | null
}>

export type ObservedBookRevision = Readonly<{
  BookID: string
  Revision: number
  UserScope: string
  Unseen: boolean
}>

export type TemporaryBookFile = object

export type BookUpload = Readonly<{ FileID: string; Bytes: Uint8Array }>

type CursorClaims = { query: string; serverRevision: number; offset: number }
type FileEntry = { id: string; bytes: Uint8Array }
type Operation = 'acquisition' | 'write' | 'export' | 'upload' | 'cleanup'

const failure = (kind: BookBackendFailure['kind'], message: string): BookBackendResult<never> => ({
  ok: false,
  error: { kind, message },
})

const queryKey = (query: BookQuery): string =>
  JSON.stringify([
    query.AuthorID === undefined ? ['absent'] : ['value', query.AuthorID],
    query.Text === undefined ? ['absent'] : ['value', query.Text.toLowerCase()],
  ])

const copyBook = (book: BookRecord): BookRecord => ({ ...book })

const normalizedBook = (book: BookInput, revision: number): BookRecord => ({
  ...book,
  LoanedOut: book.LoanedOut ?? false,
  Revision: revision,
})

const sameBook = (current: BookRecord, next: BookInput): boolean =>
  current.Title === next.Title
  && current.Note === next.Note
  && current.AuthorID === next.AuthorID
  && current.LoanedOut === (next.LoanedOut ?? false)

/** App-owned deterministic backend for Syntax2's BookIO sidecar and behavior tests. */
export class BookBackend {
  private readonly server = new Map<string, BookRecord>()
  private readonly cache = new Map<string, BookRecord>()
  private readonly cursors = new WeakMap<object, CursorClaims>()
  private revisionTokens = new WeakSet<object>()
  private readonly files = new WeakMap<object, FileEntry>()
  private readonly fileTokens = new Set<object>()
  private readonly seen = new Map<string, Set<number>>()
  private readonly failures = new Map<Operation, string[]>()
  private readonly uploads: BookUpload[] = []
  private beforePageCommit: (() => Promise<void>) | undefined
  private serverRevision = 0
  private nextFileID = 1
  private canWrite = true

  /** Seeds the server fixture only; records become observable after a successful page fetch. */
  seedServer(records: readonly BookInput[]): void {
    this.server.clear()
    this.cache.clear()
    this.seen.clear()
    this.revisionTokens = new WeakSet<object>()
    for (const record of records) {
      if (this.server.has(record.ID)) {
        continue
      }
      this.server.set(record.ID, normalizedBook(record, 1))
    }
    this.serverRevision++
  }

  /** Advances one server record; an acquired cached handle updates only after a successful fetch. */
  setServerRevision(bookID: string, revision: number): BookBackendResult<BookRecord> {
    const book = this.server.get(bookID)
    if (!book || !Number.isSafeInteger(revision) || revision <= book.Revision) {
      return failure('invalid-request', 'A book revision must advance an existing server record.')
    }
    const revised = { ...book, Revision: revision }
    this.server.set(bookID, revised)
    this.serverRevision++
    return { ok: true, value: copyBook(revised) }
  }

  /** Atomically writes app-submitted records while retaining unrelated server rows. */
  upsertBooks(records: readonly BookInput[]): BookBackendResult<void> {
    const submittedIDs = new Set<string>()
    for (const record of records) {
      if (submittedIDs.has(record.ID)) {
        return failure('invalid-request', `The book write batch contains duplicate ID '${record.ID}'.`)
      }
      submittedIDs.add(record.ID)
    }
    if (!this.canWrite) {
      return failure('permission-denied', 'The current user cannot write these books.')
    }
    const injected = this.takeFailure('write')
    if (injected !== undefined) {
      return failure('injected-failure', injected)
    }

    const pending: BookRecord[] = []
    let changed = false
    for (const record of records) {
      const current = this.server.get(record.ID)
      if (current && sameBook(current, record)) {
        pending.push(current)
        continue
      }
      changed = true
      const revision = current ? current.Revision + 1 : 1
      if (!Number.isSafeInteger(revision) || (changed && !Number.isSafeInteger(this.serverRevision + 1))) {
        return failure('invalid-request', 'The book revision cannot advance safely.')
      }
      pending.push(normalizedBook(record, revision))
    }

    for (const record of pending) {
      this.server.set(record.ID, record)
      this.cache.set(record.ID, record)
    }
    if (changed) {
      this.serverRevision++
    }
    return { ok: true, value: undefined }
  }

  failNext(operation: Operation, message: string): void {
    const queued = this.failures.get(operation) ?? []
    queued.push(message)
    this.failures.set(operation, queued)
  }

  setWritePermission(allowed: boolean): void {
    this.canWrite = allowed
  }

  /** Test seam for holding an acquisition immediately before its atomic cache commit. */
  setBeforePageCommit(hook?: () => Promise<void>): void {
    this.beforePageCommit = hook
  }

  async fetchPage(
    request: Readonly<{
      Maximum: number
      Query?: BookQuery
      Continuation?: object | null
      Signal?: AbortSignal
    }>,
  ): Promise<BookBackendResult<BookPage>> {
    if (!Number.isInteger(request.Maximum) || request.Maximum < 1 || request.Maximum > 40) {
      return failure('invalid-request', 'A book page must request between 1 and 40 records.')
    }
    if (request.Signal?.aborted) {
      return failure('cancelled', 'Book acquisition was cancelled.')
    }
    const injected = this.takeFailure('acquisition')
    if (injected !== undefined) {
      return failure('injected-failure', injected)
    }

    const query = request.Query ?? {}
    const identity = queryKey(query)
    let offset = 0
    if (request.Continuation) {
      const claims = this.cursors.get(request.Continuation)
      if (!claims || claims.query !== identity || claims.serverRevision !== this.serverRevision) {
        return failure('invalid-token', 'The book continuation is stale, foreign, or belongs to another query.')
      }
      offset = claims.offset
    }
    const serverRevision = this.serverRevision
    const rows = [...this.server.values()]
      .filter(book =>
        (query.AuthorID === undefined || book.AuthorID === query.AuthorID)
        && (query.Text === undefined || `${book.Title} ${book.Note}`.toLowerCase().includes(query.Text.toLowerCase()))
      )
      .sort((left, right) => left.ID < right.ID ? -1 : left.ID > right.ID ? 1 : 0)
    const page = rows.slice(offset, offset + request.Maximum)
    const nextOffset = offset + page.length

    await this.beforePageCommit?.()
    if (request.Signal?.aborted) {
      return failure('cancelled', 'Book acquisition was cancelled.')
    }
    if (serverRevision !== this.serverRevision) {
      return failure('server-changed', 'The book server changed during acquisition.')
    }

    for (const book of page) {
      this.cache.set(book.ID, book)
    }
    let continuation: object | null = null
    if (nextOffset < rows.length) {
      continuation = Object.freeze({})
      this.cursors.set(continuation, { query: identity, serverRevision, offset: nextOffset })
    }
    return { ok: true, value: { Books: page.map(copyBook), Continuation: continuation } }
  }

  /** Returns a snapshot from acquired cache only; this method performs no I/O or acknowledgment. */
  observeRevision(bookID: string, userScope: string): ObservedBookRevision | null {
    const book = this.cache.get(bookID)
    if (!book) {
      return null
    }
    const token = Object.freeze({
      BookID: bookID,
      Revision: book.Revision,
      UserScope: userScope,
      Unseen: !(this.seen.get(this.seenKey(bookID, userScope))?.has(book.Revision) ?? false),
    })
    this.revisionTokens.add(token)
    return token
  }

  /** Acknowledges exactly the supplied cached revision token, after permission and failure checks. */
  markSeen(revision: ObservedBookRevision): BookBackendResult<void> {
    if (!this.revisionTokens.has(revision)) {
      return failure('invalid-token', 'The supplied revision was not issued by this backend.')
    }
    if (!this.canWrite) {
      return failure('permission-denied', 'The current user cannot mark this book as seen.')
    }
    const injected = this.takeFailure('write')
    if (injected !== undefined) {
      return failure('injected-failure', injected)
    }
    const key = this.seenKey(revision.BookID, revision.UserScope)
    const revisions = this.seen.get(key) ?? new Set<number>()
    revisions.add(revision.Revision)
    this.seen.set(key, revisions)
    return { ok: true, value: undefined }
  }

  createTemporaryPDF(bookID: string): BookBackendResult<TemporaryBookFile> {
    const book = this.cache.get(bookID)
    if (!book) {
      return failure('invalid-request', 'Only an acquired book can be exported.')
    }
    if (![book.ID, book.Title, book.Note].every(supportsPDFText)) {
      return failure('invalid-request', 'PDF export supports printable ASCII book text only.')
    }
    const injected = this.takeFailure('export')
    if (injected !== undefined) {
      return failure('injected-failure', injected)
    }
    const streamContent = [
      'BT',
      '/F1 12 Tf',
      '50 740 Td',
      `(Book: ${pdfLiteral(book.ID)}) Tj`,
      '0 -18 Td',
      `(Title: ${pdfLiteral(book.Title)}) Tj`,
      '0 -18 Td',
      `(Note: ${pdfLiteral(book.Note)}) Tj`,
      'ET',
    ].join('\n')
    const bytes = new TextEncoder().encode(createPDF(`${streamContent}\n`))
    const token = Object.freeze({})
    const entry = { id: `book-export-${this.nextFileID++}`, bytes }
    this.files.set(token, entry)
    this.fileTokens.add(token)
    return { ok: true, value: token }
  }

  readTemporaryFile(file: TemporaryBookFile): BookBackendResult<Uint8Array> {
    const entry = this.files.get(file)
    if (!entry || !this.fileTokens.has(file)) {
      return failure('invalid-token', 'The temporary file is not owned by this backend.')
    }
    return { ok: true, value: entry.bytes.slice() }
  }

  uploadFile(file: TemporaryBookFile): BookBackendResult<BookUpload> {
    const entry = this.files.get(file)
    if (!entry || !this.fileTokens.has(file)) {
      return failure('invalid-token', 'The temporary file is not owned by this backend.')
    }
    const injected = this.takeFailure('upload')
    if (injected !== undefined) {
      return failure('injected-failure', injected)
    }
    const fileID = entry.id
    this.uploads.push(Object.freeze({ FileID: fileID, Bytes: entry.bytes.slice() }))
    return { ok: true, value: Object.freeze({ FileID: fileID, Bytes: entry.bytes.slice() }) }
  }

  deleteTemporaryFile(file: TemporaryBookFile): BookBackendResult<void> {
    const entry = this.files.get(file)
    if (!entry || !this.fileTokens.has(file)) {
      return failure('invalid-token', 'The temporary file is not owned by this backend.')
    }
    const injected = this.takeFailure('cleanup')
    if (injected !== undefined) {
      return failure('injected-failure', injected)
    }
    this.files.delete(file)
    this.fileTokens.delete(file)
    return { ok: true, value: undefined }
  }

  acceptedUploads(): readonly BookUpload[] {
    return this.uploads.map(upload => Object.freeze({ FileID: upload.FileID, Bytes: upload.Bytes.slice() }))
  }

  private takeFailure(operation: Operation): string | undefined {
    const queue = this.failures.get(operation)
    const message = queue?.shift()
    if (queue?.length === 0) {
      this.failures.delete(operation)
    }
    return message
  }

  private seenKey(bookID: string, userScope: string): string {
    return JSON.stringify([bookID, userScope])
  }
}

const supportsPDFText = (value: string): boolean => /^[\x20-\x7E]*$/.test(value)

const pdfLiteral = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')

const createPDF = (streamContent: string): string => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream`,
  ]
  let pdf = '%PDF-1.4\n% Syntax2 in-memory export\n'
  const offsets = objects.map((object, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}
