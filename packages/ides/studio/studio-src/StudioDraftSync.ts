import type { StudioCompileCompletion } from './StudioCompileCoordinator'

export type StudioDraftFile = {
  content: string
  path: string
  sourceVersion: string
}

export type StudioDraftSyncRequest = StudioDraftFile & {
  writeId: string
}

export type StudioDraftSyncResult = {
  compile?: StudioCompileCompletion
  diagnostics: readonly string[]
  file: StudioDraftFile
  saved: boolean
}

export type StudioDraftSyncOptions = {
  onResult?: (result: StudioDraftSyncResult) => void
  write: (request: StudioDraftSyncRequest) => Promise<StudioDraftSyncResult>
}

/** StudioDraftSync keeps edits in memory until an explicit save and serializes requested writes. */
export class StudioDraftSync {
  readonly #onResult: StudioDraftSyncOptions['onResult']
  readonly #write: StudioDraftSyncOptions['write']
  #file: StudioDraftFile
  #nextWrite = 0
  #pendingContent: string | undefined
  #lastResult: StudioDraftSyncResult | undefined
  #working: Promise<void> = Promise.resolve()
  #pendingWrites = 0

  constructor(file: StudioDraftFile, options: StudioDraftSyncOptions) {
    this.#file = file
    this.#onResult = options.onResult
    this.#write = options.write
  }

  update(content: string): void {
    this.#pendingContent = content
  }

  /** A requested save can still change the saved file even when the editor matches its old text. */
  get hasPendingWrites(): boolean {
    return this.#pendingWrites > 0
  }

  async save(): Promise<StudioDraftSyncResult | undefined> {
    const content = this.#pendingContent
    if (content === undefined) {
      await this.#working
      return this.#lastResult
    }
    this.#pendingContent = undefined
    this.#pendingWrites += 1
    const save = this.#working.then(async () => {
      let result: StudioDraftSyncResult
      try {
        result = await this.#write({
          content,
          path: this.#file.path,
          sourceVersion: this.#file.sourceVersion,
          writeId: `editor-${Date.now()}-${this.#nextWrite++}`,
        })
      } catch (error) {
        this.#restoreFailedContent(content)
        throw error
      }
      if (result.saved) {
        this.#file = result.file
      } else {
        this.#restoreFailedContent(content)
      }
      this.#lastResult = result
      this.#onResult?.(result)
      return result
    }).finally(() => {
      this.#pendingWrites -= 1
    })
    this.#working = save.then(() => undefined, () => undefined)
    return await save
  }

  #restoreFailedContent(content: string): void {
    this.#pendingContent ??= content
  }
}
