import TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'

type RecordOfWrite = Readonly<{ id: string; operations: readonly unknown[] }>
type Stored = Readonly<{ accountId: string; writes: readonly RecordOfWrite[] }>

/** Fixed-width UTF-16 hex keeps every component distinct and within SecureStore's key alphabet. */
export function pylonOutboxKey(baseURL: string, accountId: string, schemaName: string): string {
  const encode = (value: string): string => {
    let result = ''
    for (let index = 0; index < value.length; index += 1) {
      result += value.charCodeAt(index).toString(16).padStart(4, '0')
    }
    return result
  }
  return `tao.pylon.outbox.${encode(baseURL)}.${encode(accountId)}.${encode(schemaName)}`
}

/** A small account-bound operation log; server receipt ids make uncertain sends safe to retry. */
export class PylonOutbox {
  private writes: RecordOfWrite[] = []
  private loaded?: Promise<void>
  private chain: Promise<void> = Promise.resolve()
  private invalidated = false

  constructor(
    private readonly storage: TR.KeyValueStorage,
    private readonly key: string,
    private readonly accountId: string,
  ) {}

  async list(): Promise<readonly RecordOfWrite[]> {
    await this.load()
    return [...this.writes]
  }

  enqueue(write: RecordOfWrite): Promise<void> {
    return this.serialize(async () => {
      await this.load()
      if (this.invalidated) {
        throw Errors.abortError('Account data access ended.')
      }
      if (this.writes.some(item => item.id === write.id)) {
        return
      }
      const next = [...this.writes, write]
      // Keep the encrypted credential-store item bounded. Storage refusal also rejects the write.
      if (next.length > 8 || JSON.stringify(next).length > 16_000) {
        Errors.throwHostEnvironment('The Pylon offline write queue is full. Connect to sync before saving more.')
      }
      await this.save(next)
    })
  }

  acknowledge(id: string): Promise<void> {
    return this.serialize(async () => {
      await this.load()
      if (this.invalidated) {
        return
      }
      await this.save(this.writes.filter(item => item.id !== id))
    })
  }

  invalidate(): Promise<void> {
    return this.serialize(async () => {
      this.invalidated = true
      this.writes = []
      // Pending work remains encrypted and keyed by this account for a verified return.
    })
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const raw = await this.storage.getItem(this.key)
      if (!raw) {
        return
      }
      let parsed: Partial<Stored>
      try {
        parsed = JSON.parse(raw) as Partial<Stored>
      } catch {
        parsed = {}
      }
      if (
        parsed.accountId !== this.accountId || !Array.isArray(parsed.writes)
        || parsed.writes.length > 8 || raw.length > 16_000
        || parsed.writes.some(write => typeof write.id !== 'string' || !Array.isArray(write.operations))
      ) {
        await this.storage.removeItem?.(this.key)
        return
      }
      this.writes = [...parsed.writes]
    })()
    return this.loaded
  }

  private async save(next: RecordOfWrite[]): Promise<void> {
    if (next.length === 0) {
      await this.storage.removeItem?.(this.key)
    } else {
      await this.storage.setItem(this.key, JSON.stringify({ accountId: this.accountId, writes: next }))
    }
    this.writes = next
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.chain.catch(() => undefined).then(run)
    this.chain = pending.then(() => undefined, () => undefined)
    return pending
  }
}

export function nativePylonOutboxStorage(): TR.KeyValueStorage {
  const storage = TR.Auth.SecureStorage()
  Assert.input(storage !== undefined, 'Pylon pending writes require encrypted native storage.')
  return storage
}
