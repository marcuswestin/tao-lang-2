import type TR from '@runtime/TR'
import { Assert } from '@shared/core'

type AsyncStorageBoundary = Pick<
  typeof import('@react-native-async-storage/async-storage')['default'],
  'getItem' | 'removeItem' | 'setItem'
>

const keyPrefix = 'tao-data'
const storageQueues = new WeakMap<AsyncStorageBoundary, Map<string, Promise<void>>>()

/** LocalProvider persists full datasource snapshots through React Native AsyncStorage. */
export function LocalProvider(loadStorage: () => AsyncStorageBoundary = asyncStorage): TR.DataProvider {
  return {
    connect: context => {
      const storage = loadStorage()
      const storageKey = `${keyPrefix}:${context.storageKey}`
      let closed = false
      let pendingWrites: Promise<void> = Promise.resolve()
      let queues = storageQueues.get(storage)
      if (!queues) {
        queues = new Map()
        storageQueues.set(storage, queues)
      }
      const sharedQueues = queues
      // A remount must load after an older connection's started write, even when sign-out
      // invalidated that connection. Admitted snapshots drain under their original account key;
      // invalidation rejects later admissions, rather than losing already-committed rows.
      const run = <T>(operation: () => Promise<T>): Promise<T> => {
        Assert.input(!closed && !context.signal?.aborted, 'This local data connection is no longer active.')
        const result = (sharedQueues.get(storageKey) ?? Promise.resolve()).then(operation)
        const settled = result.then(() => undefined, () => undefined)
        sharedQueues.set(storageKey, settled)
        void settled.then(() => {
          if (sharedQueues.get(storageKey) === settled) {
            sharedQueues.delete(storageKey)
          }
        })
        return result
      }
      return {
        close: () => {
          closed = true
        },
        invalidateAuth: () => {
          closed = true
          return pendingWrites
        },
        load: async () => run(async () => (await storage.getItem(storageKey)) ?? undefined),
        referenceToken: reference => reference.id,
        reset: async () => run(() => storage.removeItem(storageKey)),
        resolveReference: reference => reference.token,
        save: async snapshot => {
          // Admission must succeed before replacing the drain. The async public boundary still
          // rejects expired calls, while accepted snapshots reserve their key queue immediately.
          const saving = run(() => storage.setItem(storageKey, snapshot))
          // Every snapshot is cumulative, and the key queue waits for all earlier operations.
          // A successful newer snapshot therefore supersedes a recoverable earlier failure.
          pendingWrites = saving
          // The save caller sees failure immediately; invalidation must also report a failed drain.
          void pendingWrites.catch(() => undefined)
          return saving
        },
      }
    },
  }
}

function asyncStorage(): AsyncStorageBoundary {
  const required = require('@react-native-async-storage/async-storage') as
    | AsyncStorageBoundary
    | { default: AsyncStorageBoundary }
  return 'default' in required ? required.default : required
}
