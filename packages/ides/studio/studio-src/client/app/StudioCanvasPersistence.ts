import type { StudioCanvasViewport, StudioCanvasViewportSaveRequest } from '../../StudioProtocol'

/** Coalesces camera motion; sequence numbers keep a late normal save behind a page-hide save. */
export class StudioCanvasPersistence {
  readonly #clientId: string
  readonly #save: (request: StudioCanvasViewportSaveRequest, keepalive: boolean) => Promise<unknown>
  readonly #onError: (error: unknown) => void
  #sequence = 0
  #latest: StudioCanvasViewport | undefined
  #last: StudioCanvasViewport | undefined
  #pending = 0
  #timer: ReturnType<typeof setTimeout> | undefined
  #disposed = false

  constructor(deps: {
    clientId: string
    save: (request: StudioCanvasViewportSaveRequest, keepalive: boolean) => Promise<unknown>
    onError: (error: unknown) => void
  }) {
    this.#clientId = deps.clientId
    this.#save = deps.save
    this.#onError = deps.onError
  }

  changed(viewport: StudioCanvasViewport): void {
    if (this.#disposed) {
      return
    }
    this.#latest = { ...viewport }
    this.#last = this.#latest
    // A bounded cadence also saves a long, uninterrupted gesture.
    this.#timer ??= setTimeout(() => {
      void this.flush()
    }, 150)
  }

  async flush(keepalive = false): Promise<void> {
    clearTimeout(this.#timer)
    this.#timer = undefined
    const viewport = this.#latest ?? (keepalive && this.#pending > 0 ? this.#last : undefined)
    if (viewport === undefined) {
      return
    }
    this.#latest = undefined
    const sequence = ++this.#sequence
    this.#pending++
    try {
      await this.#save({ clientId: this.#clientId, sequence, viewport }, keepalive)
    } catch (error) {
      // Retain only a failed latest write; never replace a newer gesture with an old request.
      if (sequence === this.#sequence && this.#latest === undefined) {
        this.#latest = viewport
      }
      if (!this.#disposed) {
        this.#onError(error)
      }
    } finally {
      this.#pending--
    }
  }

  dispose(): void {
    this.#disposed = true
    void this.flush(true)
  }
}
