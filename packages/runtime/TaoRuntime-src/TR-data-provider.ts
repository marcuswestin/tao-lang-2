import type {
  TaoDataProvider,
  TaoDataProviderFactory,
  TaoKeyValueStorage,
} from './TR-data'

/** MemoryProvider creates one isolated, storage-keyed provider whose envelopes live only in this process. */
export function MemoryProvider(initial?: string): TaoDataProvider {
  const stored = new Map<string, string>()
  let initialStorageKey: string | undefined

  const initialize = (storageKey: string): void => {
    if (initial !== undefined && initialStorageKey === undefined) {
      initialStorageKey = storageKey
      stored.set(storageKey, initial)
    }
  }

  return {
    load: storageKey => {
      initialize(storageKey)
      return stored.get(storageKey)
    },
    persist: (storageKey, value) => {
      initialize(storageKey)
      stored.set(storageKey, value)
    },
  }
}

/** LocalProvider persists envelopes through AsyncStorage without silently degrading to memory. */
function LocalProvider(storage?: TaoKeyValueStorage, keyPrefix = 'tao-data'): TaoDataProvider {
  const keyValueStorage = (): TaoKeyValueStorage => storage ?? asyncStorage()
  return {
    load: async storageKey => (await keyValueStorage().getItem(`${keyPrefix}:${storageKey}`)) ?? undefined,
    persist: async (storageKey, value) => {
      await keyValueStorage().setItem(`${keyPrefix}:${storageKey}`, value)
    },
  }
}

/** DataProviderControls is the published injection API for shipped data-provider implementations. */
export const DataProviderControls = {
  Local: LocalProvider,
  Memory: MemoryProvider,
} as const

/**
 * testProvider checks the full-snapshot provider protocol without importing a test runner.
 * A rejecting factory is explicit so the suite proves failures cross the real provider boundary.
 */
export async function testProvider(
  createProvider: TaoDataProviderFactory,
  createRejectingProvider: TaoDataProviderFactory,
): Promise<void> {
  const run = ++providerConformanceRun
  const key = (name: string): string => `tao-provider-conformance-${run}-${name}`
  const provider = createProvider()

  assertProviderConformance(
    await provider.load(key('empty')) === undefined,
    'load must return undefined for an empty storage key.',
  )

  const roundTripSnapshot = '{"snapshot":"round-trip"}'
  await provider.persist(key('round-trip'), roundTripSnapshot)
  assertProviderConformance(
    await provider.load(key('round-trip')) === roundTripSnapshot,
    'persisted snapshots must round-trip exactly.',
  )

  const firstKey = key('first-schema')
  const secondKey = key('second-schema')
  await provider.persist(firstKey, '{"schema":"first"}')
  await provider.persist(secondKey, '{"schema":"second"}')
  assertProviderConformance(
    await provider.load(firstKey) === '{"schema":"first"}'
      && await provider.load(secondKey) === '{"schema":"second"}',
    'storage keys must remain isolated.',
  )

  const orderedKey = key('ordered')
  await provider.persist(orderedKey, '{"sequence":1}')
  await provider.persist(orderedKey, '{"sequence":2}')
  assertProviderConformance(
    await provider.load(orderedKey) === '{"sequence":2}',
    'later full snapshots must replace earlier snapshots in call order.',
  )

  const firstInstance = createProvider()
  const secondInstance = createProvider()
  const instanceKey = key('instance')
  await firstInstance.persist(instanceKey, '{"instance":"first"}')
  const secondStart = await secondInstance.load(instanceKey)
  assertProviderConformance(
    secondStart === undefined || secondStart === '{"instance":"first"}',
    'provider instances must be isolated or share one stateless storage boundary.',
  )
  await secondInstance.persist(instanceKey, '{"instance":"second"}')
  assertProviderConformance(
    await firstInstance.load(instanceKey) === (
      secondStart === undefined ? '{"instance":"first"}' : '{"instance":"second"}'
    ),
    'provider instances must not partially share state.',
  )

  let rejected = false
  try {
    await createRejectingProvider().persist(key('rejection'), '{"snapshot":"rejected"}')
  } catch {
    rejected = true
  }
  assertProviderConformance(rejected, 'persist must propagate storage rejection.')
}

let providerConformanceRun = 0

function assertProviderConformance(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`DataProvider conformance failed: ${message}`)
  }
}

export function UnboundProvider(schemaName: string): TaoDataProvider {
  const message = `Data schema '${schemaName}' has no bound provider.`
  return {
    load: () => {
      throw new Error(message)
    },
    persist: () => {
      throw new Error(message)
    },
  }
}

function asyncStorage(): TaoKeyValueStorage {
  const required = require('@react-native-async-storage/async-storage') as
    | TaoKeyValueStorage
    | { default: TaoKeyValueStorage }
  return 'default' in required ? required.default : required
}
