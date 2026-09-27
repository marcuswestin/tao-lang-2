/** Owns resources from their acquisition, including while the workbench is still starting. */
export class StudioMountLifetime {
  readonly #controller = new AbortController()
  readonly #cleanups: (() => void)[] = []

  constructor(signal?: AbortSignal) {
    if (signal?.aborted) {
      this.dispose()
    } else if (signal !== undefined) {
      signal.addEventListener('abort', this.dispose, { once: true })
      this.add(() => signal.removeEventListener('abort', this.dispose))
    }
  }

  get signal(): AbortSignal {
    return this.#controller.signal
  }

  add(cleanup: () => void): void {
    if (this.signal.aborted) {
      cleanup()
    } else {
      this.#cleanups.push(cleanup)
    }
  }

  readonly dispose = (): void => {
    if (this.signal.aborted) {
      return
    }
    this.#controller.abort()
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      cleanup()
    }
  }
}
