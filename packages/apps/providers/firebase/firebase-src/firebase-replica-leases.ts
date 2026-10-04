import { Assert, Errors } from '@shared/core'
import type { FirebaseReplica } from './firebase-replica'

type Entry = {
  signature: string
  refs: number
  opening: Promise<FirebaseReplica>
  closing?: Promise<void>
}

/** One open database per project/store/account, with independent connection subscriptions. */
export class FirebaseReplicaLeases {
  private readonly entries = new Map<string, Entry>()

  async acquire(key: string, signature: string, create: () => Promise<FirebaseReplica>): Promise<FirebaseReplica> {
    while (true) {
      const existing = this.entries.get(key)
      if (existing?.closing) {
        await existing.closing
        continue
      }
      Assert.input(
        existing === undefined || existing.signature === signature,
        'Firebase datasources sharing a project, store, and account must declare the same schema.',
      )
      const entry: Entry = existing ?? { signature, refs: 0, opening: Promise.resolve().then(create) }
      if (existing === undefined) {
        this.entries.set(key, entry)
      }
      entry.refs += 1
      let resource: FirebaseReplica
      try {
        resource = await entry.opening
      } catch (error) {
        entry.refs -= 1
        if (this.entries.get(key) === entry) {
          this.entries.delete(key)
        }
        throw error
      }
      let closed = false
      let closePromise: Promise<void> | undefined
      const subscriptions = new Set<() => void>()
      const entries = this.entries
      const ensureOpen = (): void => {
        if (closed) {
          throw Errors.abortError('Firebase account data access ended.')
        }
      }
      return {
        rows: () => {
          ensureOpen()
          return resource.rows()
        },
        upsert: (entity, row) => {
          ensureOpen()
          return resource.upsert(entity, row)
        },
        remove: (entity, id) => {
          ensureOpen()
          return resource.remove(entity, id)
        },
        subscribe(listener, error) {
          ensureOpen()
          const stop = resource.subscribe(
            () => {
              if (!closed) {
                listener()
              }
            },
            cause => {
              if (!closed) {
                error(cause)
              }
            },
          )
          subscriptions.add(stop)
          return () => {
            if (subscriptions.delete(stop)) {
              stop()
            }
          }
        },
        close() {
          if (closePromise) {
            return closePromise
          }
          closed = true
          for (const stop of subscriptions) {
            stop()
          }
          subscriptions.clear()
          entry.refs -= 1
          if (entry.refs > 0) {
            closePromise = Promise.resolve()
            return closePromise
          }
          entry.closing = Promise.resolve().then(() => resource.close()).finally(() => {
            if (entries.get(key) === entry) {
              entries.delete(key)
            }
          })
          closePromise = entry.closing
          return closePromise
        },
      }
    }
  }
}
