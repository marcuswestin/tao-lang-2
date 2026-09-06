/** Coalesces a burst of invalidations into one current fill after any in-flight fill. */
export class StudioDataFillCoordinator {
  #completedRevision = 0
  #requestedRevision = 0
  #running: Promise<void> | undefined
  readonly #fill: (isLatest: () => boolean) => Promise<void>

  constructor(fill: (isLatest: () => boolean) => Promise<void>) {
    this.#fill = fill
  }

  request(): Promise<void> {
    this.#requestedRevision += 1
    this.#running ??= this.#drain()
    return this.#running
  }

  async #drain(): Promise<void> {
    try {
      while (this.#completedRevision < this.#requestedRevision) {
        const revision = this.#requestedRevision
        await this.#fill(() => revision === this.#requestedRevision)
        this.#completedRevision = revision
      }
    } finally {
      this.#running = undefined
    }
  }
}
