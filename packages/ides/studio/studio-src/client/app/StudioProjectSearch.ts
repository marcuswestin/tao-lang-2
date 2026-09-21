import { StudioApiClient, type StudioCompileDiagnostic, type StudioFile } from '../StudioApiClient'
import { StudioRailPanels, type StudioSearchResult } from '../StudioRailPanels'
import { showSourceActionError } from '../StudioVisualEditing'
import type { StudioOpenDocument } from './StudioEditorSession'
import { studioSourceVersions } from './StudioProductHostState'

export type StudioProjectSearchDeps = Readonly<{
  diagnostics: () => readonly StudioCompileDiagnostic[]
  input: HTMLInputElement
  /** The live text of an open tab, so search sees what the editor shows rather than the disk. */
  openDocument: (path: string) => StudioOpenDocument | undefined
  project: string
  projectFiles: () => readonly StudioFile[]
  publish: () => void
  signal: AbortSignal | undefined
  status: HTMLElement
}>

/** Project-wide search over open tabs, cached file contents, and the compile diagnostics. */
export class StudioProjectSearch {
  readonly #deps: StudioProjectSearchDeps
  readonly #documents = new Map<string, { content: string; sourceVersion: string }>()
  #results: readonly StudioSearchResult[] = []
  #revision = 0
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(deps: StudioProjectSearchDeps) {
    this.#deps = deps
  }

  results(): readonly StudioSearchResult[] {
    return this.#results
  }

  hasQuery(): boolean {
    return this.#deps.input.value.trim() !== ''
  }

  schedule(delayMs = 150): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => void this.#search(), delayMs)
  }

  /** Re-runs a search already on screen after the sources it read changed. */
  scheduleIfActive(): void {
    if (this.hasQuery()) {
      this.schedule()
    }
  }

  /** Drops cached documents the new listing no longer matches. */
  invalidate(files: readonly StudioFile[]): void {
    for (const [path, cached] of this.#documents) {
      const file = files.find(candidate => candidate.path === path)
      if (file === undefined || file.sourceVersion !== cached.sourceVersion) {
        this.#documents.delete(path)
      }
    }
  }

  dispose(): void {
    clearTimeout(this.#timer)
  }

  async #search(): Promise<void> {
    const revision = ++this.#revision
    const query = this.#deps.input.value
    if (query.trim() === '') {
      this.#results = []
      this.#deps.publish()
      return
    }
    let documents: Array<{ content: string; path: string; sourceVersion?: string }>
    try {
      documents = await Promise.all(
        this.#deps.projectFiles().map(async file => {
          const opened = this.#deps.openDocument(file.path)
          const content = opened?.content ?? await this.#cachedDocument(file)
          return {
            content,
            path: file.path,
            ...(opened !== undefined && !opened.saved ? {} : { sourceVersion: file.sourceVersion }),
          }
        }),
      )
    } catch (error) {
      if (revision === this.#revision) {
        showSourceActionError(this.#deps.status, error)
      }
      return
    }
    if (revision !== this.#revision) {
      return
    }
    this.#results = StudioRailPanels.search(
      documents,
      this.#deps.diagnostics(),
      query,
      studioSourceVersions(this.#deps.project, this.#deps.projectFiles()),
    )
    this.#deps.publish()
  }

  async #cachedDocument(file: StudioFile): Promise<string> {
    const cached = this.#documents.get(file.path)
    if (cached?.sourceVersion === file.sourceVersion) {
      return cached.content
    }
    const opened = await StudioApiClient.file(file.path, this.#deps.signal)
    this.#documents.set(file.path, { content: opened.content, sourceVersion: opened.sourceVersion })
    return opened.content
  }
}
