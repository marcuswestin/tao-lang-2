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

  constructor(file: StudioDraftFile, options: StudioDraftSyncOptions) {
    this.#file = file
    this.#onResult = options.onResult
    this.#write = options.write
  }

  update(content: string): void {
    this.#pendingContent = content
  }

  async save(): Promise<StudioDraftSyncResult | undefined> {
    const content = this.#pendingContent
    if (content === undefined) {
      await this.#working
      return this.#lastResult
    }
    this.#pendingContent = undefined
    const save = this.#working.then(async () => {
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
      return result
    })
    this.#working = save.then(() => undefined, () => undefined)
    return await save
  }
}
