export type StudioDraftFile = {
  content: string
  path: string
  sourceVersion: string
}

export type StudioDraftSyncRequest = StudioDraftFile & {
  writeId: string
}

export type StudioDraftSyncResult = {
  diagnostics: readonly string[]
  file: StudioDraftFile
  saved: boolean
}

export type StudioDraftSyncOptions = {
  delayMs?: number
  onResult?: (result: StudioDraftSyncResult) => void
  write: (request: StudioDraftSyncRequest) => Promise<StudioDraftSyncResult>
}

/** StudioDraftSync coalesces editor changes and serializes optimistic disk-synced drafts. */
export class StudioDraftSync {
  readonly #delayMs: number
  readonly #onResult: StudioDraftSyncOptions['onResult']
  readonly #write: StudioDraftSyncOptions['write']
  #file: StudioDraftFile
  #nextWrite = 0
  #pendingContent: string | undefined
  #lastResult: StudioDraftSyncResult | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #working: Promise<void> | undefined

  constructor(file: StudioDraftFile, options: StudioDraftSyncOptions) {
    this.#file = file
    this.#delayMs = options.delayMs ?? 120
    this.#onResult = options.onResult
    this.#write = options.write
  }

  update(content: string): void {
    this.#pendingContent = content
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#start()
    }, this.#delayMs)
  }

  async flush(): Promise<StudioDraftSyncResult | undefined> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    await this.#start()
    return this.#lastResult
  }

  async #start(): Promise<void> {
    this.#working ??= this.#drain().finally(() => {
      this.#working = undefined
    })
    await this.#working
    if (this.#pendingContent !== undefined) {
      await this.#start()
    }
  }

  async #drain(): Promise<void> {
    while (this.#pendingContent !== undefined) {
      const content = this.#pendingContent
      this.#pendingContent = undefined
      const result = await this.#write({
        content,
        path: this.#file.path,
        sourceVersion: this.#file.sourceVersion,
        writeId: `editor-${Date.now()}-${this.#nextWrite++}`,
      })
      if (result.saved) {
        this.#file = result.file
      }
      this.#lastResult = result
      this.#onResult?.(result)
    }
  }
}
