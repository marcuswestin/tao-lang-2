import { Time } from '@shared/core'
import type { StudioDeviceStatus } from '../../device/StudioDeviceStatus'
import type { StudioDraftSyncResult } from '../../StudioDraftSync'

type PhoneStatus = Pick<StudioDeviceStatus, 'connection'>

export type StudioPhoneSaveGateOptions = {
  now?: () => number
  onUnsynced?: (revision: number) => void
  onWaiting?: (revision: number) => void
  pollMs?: number
  sleep?: (ms: number) => Promise<void>
  status: () => Promise<PhoneStatus>
  timeoutMs?: number
}

/** Saves remain ordered, but a disconnected phone cannot hold the editor indefinitely. */
export class StudioPhoneSaveGate {
  readonly #now: () => number
  readonly #onUnsynced: ((revision: number) => void) | undefined
  readonly #onWaiting: ((revision: number) => void) | undefined
  readonly #pollMs: number
  readonly #sleep: (ms: number) => Promise<void>
  readonly #status: () => Promise<PhoneStatus>
  readonly #timeoutMs: number
  #lane: Promise<void> = Promise.resolve()
  #pendingPhone: Promise<void> = Promise.resolve()
  #pendingRevision: number | undefined

  constructor(options: StudioPhoneSaveGateOptions) {
    this.#now = options.now ?? Time.nowMs
    this.#onUnsynced = options.onUnsynced
    this.#onWaiting = options.onWaiting
    this.#pollMs = options.pollMs ?? 250
    this.#sleep = options.sleep ?? Time.sleep
    this.#status = options.status
    this.#timeoutMs = options.timeoutMs ?? 5_000
  }

  run(write: () => Promise<StudioDraftSyncResult>): Promise<StudioDraftSyncResult> {
    const operation = this.#lane.then(async () => {
      if (this.#pendingRevision !== undefined) {
        this.#onWaiting?.(this.#pendingRevision)
      }
      await this.#pendingPhone
      const result = await write()
      if (result.saved && result.compile?.status === 'compiled') {
        const revision = result.compile.compileRevision
        const status = await this.#readStatus()
        if (status?.connection?.state === 'connected' && (status.connection.appliedRevision ?? 0) < revision) {
          this.#pendingRevision = revision
          this.#pendingPhone = this.#awaitPhone(revision)
        }
      }
      return result
    })
    this.#lane = operation.then(() => undefined, () => undefined)
    return operation
  }

  async #awaitPhone(revision: number): Promise<void> {
    let disconnectedAt: number | undefined
    while (true) {
      await this.#sleep(this.#pollMs)
      const status = await this.#readStatus()
      if (status?.connection?.state === 'connected') {
        if ((status.connection.appliedRevision ?? 0) >= revision) {
          this.#pendingRevision = undefined
          return
        }
        disconnectedAt = undefined
        continue
      }
      disconnectedAt ??= this.#now()
      if (this.#now() - disconnectedAt >= this.#timeoutMs) {
        this.#pendingRevision = undefined
        this.#onUnsynced?.(revision)
        return
      }
    }
  }

  async #readStatus(): Promise<PhoneStatus | undefined> {
    try {
      return await this.#status()
    } catch {
      // A local server or device-status failure has the same bounded outcome as a disconnected phone.
      return undefined
    }
  }
}
