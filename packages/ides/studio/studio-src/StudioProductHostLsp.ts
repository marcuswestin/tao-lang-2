import type { StudioLspTransport } from './client/StudioApiClient'

/** Owns one ProductHost editor transport, including a connection that resolves after unmount. */
export class StudioProductHostLspLifecycle {
  readonly #cancel: () => void
  readonly #connect: () => Promise<StudioLspTransport>
  #closed = false
  #opening: Promise<StudioLspTransport | undefined> | undefined
  #transport: StudioLspTransport | undefined

  constructor(connect: () => Promise<StudioLspTransport>, cancel: () => void = () => {}) {
    this.#cancel = cancel
    this.#connect = connect
  }

  open(): Promise<StudioLspTransport | undefined> {
    this.#opening ??= this.#connect().then(transport => {
      if (this.#closed) {
        transport.close()
        return undefined
      }
      this.#transport = transport
      return transport
    })
    return this.#opening
  }

  close(): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#cancel()
    this.#transport?.close()
    this.#transport = undefined
  }
}
