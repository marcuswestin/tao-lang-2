import type { StudioPreviewAppliedMessage, StudioProjectIdentity } from './StudioProtocol'

export type StudioCompileDiagnostic = {
  filePath?: string
  message: string
  range?: {
    end: { character: number; line: number }
    start: { character: number; line: number }
  }
}

export type StudioCompileCause = 'initial' | 'studio-write' | 'watch'

export type StudioSourceChange = {
  path: string
  sourceVersion?: string
}

export type StudioCompileRequest = StudioProjectIdentity & {
  causes: readonly StudioCompileCause[]
  changes: readonly StudioSourceChange[]
  compileRevision: number
}

export type StudioCompileOutput = {
  message?: string
}

export type StudioCompileCompletion = {
  causes: readonly StudioCompileCause[]
  changes: readonly StudioSourceChange[]
  compileRevision: number
  diagnostics: readonly StudioCompileDiagnostic[]
  message: string
  status: 'compiled' | 'error'
}

export type StudioCompileSnapshot = StudioProjectIdentity & {
  appliedRevision: number
  compileRevision: number
  diagnostics: readonly StudioCompileDiagnostic[]
  message: string
  previewInstanceId?: string
  status: 'idle' | 'compiling' | 'compiled' | 'error'
}

export type StudioWrite = {
  path: string
  sourceVersion?: string
  writeId: string
}

export type StudioWriteAcknowledgement = StudioWrite & {
  compileRevision: number
}

export type StudioWatchResult = {
  acknowledgements: readonly StudioWriteAcknowledgement[]
  compile?: StudioCompileCompletion
}

export type StudioCompileCoordinatorOptions = StudioProjectIdentity & {
  compile: (request: StudioCompileRequest) => Promise<StudioCompileOutput | void>
  onState?: (state: StudioCompileSnapshot) => void
}

type PendingBatch = {
  causes: Set<StudioCompileCause>
  changes: Map<string, StudioSourceChange>
  waiters: Array<{
    reject: (reason?: unknown) => void
    resolve: (completion: StudioCompileCompletion) => void
  }>
}

type TrackedStudioWrite = StudioWrite & {
  completion: Promise<StudioCompileCompletion>
}

const trackedStudioWriteLimit = 100

/**
 * StudioCompileCoordinator is the single compile lane for editor writes and filesystem events.
 * Signals received during a compile are coalesced into one following revision, never run concurrently.
 */
export class StudioCompileCoordinator {
  readonly #compile: StudioCompileCoordinatorOptions['compile']
  readonly #compiledRevisions = new Set<number>()
  readonly #onState: StudioCompileCoordinatorOptions['onState']
  readonly #project: StudioProjectIdentity
  readonly #studioWrites = new Map<string, TrackedStudioWrite[]>()
  #appliedRevision = 0
  #compileRevision = 0
  #diagnostics: readonly StudioCompileDiagnostic[] = []
  #message = 'Studio compile coordinator is idle.'
  #pending: PendingBatch | undefined
  #previewInstanceId: string | undefined
  #scheduled = false
  #status: StudioCompileSnapshot['status'] = 'idle'
  #working = false

  constructor(options: StudioCompileCoordinatorOptions) {
    this.#compile = options.compile
    this.#onState = options.onState
    this.#project = { appName: options.appName, project: options.project }
  }

  snapshot(): StudioCompileSnapshot {
    return {
      ...this.#project,
      appliedRevision: this.#appliedRevision,
      compileRevision: this.#compileRevision,
      diagnostics: this.#diagnostics,
      message: this.#message,
      previewInstanceId: this.#previewInstanceId,
      status: this.#status,
    }
  }

  requestInitialCompile(): Promise<StudioCompileCompletion> {
    return this.#requestCompile('initial', [])
  }

  /** noteStudioWrite schedules its compile and records the exact source version the watcher should acknowledge. */
  noteStudioWrite(write: StudioWrite & { sourceVersion: string }): Promise<StudioCompileCompletion> {
    return this.noteStudioFileMutation([write])
  }

  /** noteStudioFileMutation compiles and tracks create, rename, and deletion watcher echoes as one mutation. */
  noteStudioFileMutation(writes: readonly StudioWrite[]): Promise<StudioCompileCompletion> {
    const completion = this.#requestCompile(
      'studio-write',
      writes.map(({ path, sourceVersion }) => ({ path, sourceVersion })),
    )
    for (const write of writes) {
      const tracked = this.#studioWrites.get(write.path) ?? []
      tracked.push({ ...write, completion })
      if (tracked.length > trackedStudioWriteLimit) {
        tracked.splice(0, tracked.length - trackedStudioWriteLimit)
      }
      this.#studioWrites.set(write.path, tracked)
    }
    return completion
  }

  /**
   * noteWatchChanges consumes exact Studio write echoes without compiling twice. Any unmatched change is external
   * and enters the serialized compile lane. Matching requires both canonical path and sourceVersion.
   */
  async noteWatchChanges(changes: readonly StudioSourceChange[]): Promise<StudioWatchResult> {
    const matched: TrackedStudioWrite[] = []
    const external: StudioSourceChange[] = []
    const uniqueChanges = new Map(changes.map(change => [sourceChangeKey(change), change]))
    for (const change of uniqueChanges.values()) {
      const write = this.#takeMatchingStudioWrite(change)
      if (write === undefined) {
        this.#studioWrites.delete(change.path)
        external.push(change)
      } else {
        matched.push(write)
      }
    }

    const compile = external.length === 0 ? undefined : await this.#requestCompile('watch', external)
    const completions = await Promise.all(matched.map(write => write.completion))
    return {
      acknowledgements: matched.map((write, index) => ({
        path: write.path,
        sourceVersion: write.sourceVersion,
        writeId: write.writeId,
        compileRevision: completions[index]!.compileRevision,
      })),
      compile,
    }
  }

  /** setPreviewInstance starts a fresh applied-revision stream after iframe replacement/reload. */
  setPreviewInstance(previewInstanceId: string): void {
    if (previewInstanceId.trim().length === 0) {
      throw new Error('Studio previewInstanceId must not be empty.')
    }
    if (previewInstanceId === this.#previewInstanceId) {
      return
    }
    this.#previewInstanceId = previewInstanceId
    this.#appliedRevision = 0
    this.#emitState()
  }

  /** acknowledgePreview advances appliedRevision only for this coordinator's current, successfully compiled preview. */
  acknowledgePreview(message: StudioPreviewAppliedMessage): boolean {
    if (
      message.identity.project !== this.#project.project
      || message.identity.appName !== this.#project.appName
      || message.identity.previewInstanceId !== this.#previewInstanceId
    ) {
      return false
    }
    return this.acknowledgeCompiledRevision(message)
  }

  /** Matrix sessions authenticate cell-instance identity before advancing the shared applied revision. */
  acknowledgeCompiledRevision(message: StudioPreviewAppliedMessage): boolean {
    if (
      message.identity.project !== this.#project.project
      || message.identity.appName !== this.#project.appName
      || message.compileRevision !== message.appliedRevision
      || message.appliedRevision <= this.#appliedRevision
      || !this.#compiledRevisions.has(message.appliedRevision)
    ) {
      return false
    }
    this.#appliedRevision = message.appliedRevision
    this.#emitState()
    return true
  }

  #requestCompile(cause: StudioCompileCause, changes: readonly StudioSourceChange[]): Promise<StudioCompileCompletion> {
    const pending = this.#pending ?? this.#newPendingBatch()
    pending.causes.add(cause)
    for (const change of changes) {
      pending.changes.set(change.path, change)
    }
    const promise = new Promise<StudioCompileCompletion>((resolve, reject) => {
      pending.waiters.push({ reject, resolve })
    })
    this.#scheduleDrain()
    return promise
  }

  #newPendingBatch(): PendingBatch {
    const pending: PendingBatch = {
      causes: new Set(),
      changes: new Map(),
      waiters: [],
    }
    this.#pending = pending
    return pending
  }

  #scheduleDrain(): void {
    if (this.#scheduled || this.#working) {
      return
    }
    this.#scheduled = true
    queueMicrotask(() => {
      this.#scheduled = false
      void this.#drain()
    })
  }

  async #drain(): Promise<void> {
    if (this.#working) {
      return
    }
    this.#working = true
    try {
      while (this.#pending !== undefined) {
        const batch = this.#pending
        this.#pending = undefined
        try {
          const completion = await this.#compileBatch(batch)
          for (const waiter of batch.waiters) {
            waiter.resolve(completion)
          }
        } catch (error) {
          for (const waiter of batch.waiters) {
            waiter.reject(error)
          }
        }
      }
    } finally {
      this.#working = false
      if (this.#pending !== undefined) {
        this.#scheduleDrain()
      }
    }
  }

  async #compileBatch(batch: PendingBatch): Promise<StudioCompileCompletion> {
    this.#compileRevision += 1
    const request: StudioCompileRequest = {
      ...this.#project,
      causes: [...batch.causes],
      changes: [...batch.changes.values()],
      compileRevision: this.#compileRevision,
    }
    this.#status = 'compiling'
    this.#diagnostics = []
    this.#message = `Compiling ${this.#project.appName} revision ${this.#compileRevision}.`
    this.#emitState()
    try {
      const output = await this.#compile(request)
      this.#compiledRevisions.add(request.compileRevision)
      this.#status = 'compiled'
      this.#diagnostics = []
      this.#message = output?.message ?? `Compiled ${this.#project.appName} revision ${this.#compileRevision}.`
    } catch (error) {
      this.#status = 'error'
      this.#diagnostics = compileDiagnostics(error)
      this.#message = error instanceof Error ? error.message : String(error)
    }
    const completion: StudioCompileCompletion = {
      causes: request.causes,
      changes: request.changes,
      compileRevision: request.compileRevision,
      diagnostics: this.#diagnostics,
      message: this.#message,
      status: this.#status,
    }
    this.#emitState()
    return completion
  }

  #takeMatchingStudioWrite(change: StudioSourceChange): TrackedStudioWrite | undefined {
    const writes = this.#studioWrites.get(change.path)
    const index = writes?.findIndex(write => write.sourceVersion === change.sourceVersion) ?? -1
    if (writes === undefined || index < 0) {
      return undefined
    }
    // Observing a later write proves every earlier queued version for this path is obsolete, even
    // if its watcher event was coalesced away. Retaining one could misclassify a later external
    // revert to the same bytes as a delayed Studio echo.
    const [write] = writes.splice(index, 1)
    writes.splice(0, index)
    if (writes.length === 0) {
      this.#studioWrites.delete(change.path)
    }
    return write
  }

  #emitState(): void {
    this.#onState?.(this.snapshot())
  }
}

function compileDiagnostics(error: unknown): readonly StudioCompileDiagnostic[] {
  if (typeof error !== 'object' || error === null || !('details' in error)) {
    return []
  }
  const details = error.details
  if (typeof details !== 'object' || details === null || !('diagnostics' in details)) {
    return []
  }
  const diagnostics = details.diagnostics
  return Array.isArray(diagnostics) ? diagnostics.filter(isCompileDiagnostic) : []
}

function isCompileDiagnostic(value: unknown): value is StudioCompileDiagnostic {
  if (typeof value !== 'object' || value === null || !('message' in value) || typeof value.message !== 'string') {
    return false
  }
  if ('filePath' in value && value.filePath !== undefined && typeof value.filePath !== 'string') {
    return false
  }
  if (!('range' in value) || value.range === undefined) {
    return true
  }
  const range = value.range
  return typeof range === 'object'
    && range !== null
    && pointIsCompileLocation('start' in range ? range.start : undefined)
    && pointIsCompileLocation('end' in range ? range.end : undefined)
}

function pointIsCompileLocation(value: unknown): value is { character: number; line: number } {
  return typeof value === 'object'
    && value !== null
    && 'character' in value
    && Number.isSafeInteger(value.character)
    && 'line' in value
    && Number.isSafeInteger(value.line)
}

function sourceChangeKey(change: StudioSourceChange): string {
  return `${change.path}\u0000${change.sourceVersion ?? ''}`
}
