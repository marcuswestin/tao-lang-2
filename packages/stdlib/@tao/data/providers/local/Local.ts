import type TR from '@runtime/TR'

type AsyncStorageBoundary = Pick<
  typeof import('@react-native-async-storage/async-storage')['default'],
  'getItem' | 'removeItem' | 'setItem'
>

const keyPrefix = 'tao-data'

/** LocalProvider persists full datasource snapshots through React Native AsyncStorage. */
export function LocalProvider(loadStorage: () => AsyncStorageBoundary = asyncStorage): TR.DataProvider {
  return {
    connect: context => {
      const storage = loadStorage()
      const storageKey = `${keyPrefix}:${context.storageKey}`
      return {
        load: async () => (await storage.getItem(storageKey)) ?? undefined,
        reset: async () => {
          await storage.removeItem(storageKey)
        },
        save: async snapshot => {
          await storage.setItem(storageKey, snapshot)
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
