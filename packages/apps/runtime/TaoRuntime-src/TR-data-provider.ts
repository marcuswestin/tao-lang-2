import { RuntimeAssert } from './TR-assert'
import type {
  TaoDataConnection,
  TaoDataProvider,
  TaoDataProviderContext,
  TaoDataProviderFactory,
  TaoDataSchemaDefinition,
  TaoKeyValueStorage,
} from './TR-data'
import { UserInputError } from './TR-errors'

const conformanceSchema: TaoDataSchemaDefinition = {
  entities: {},
  name: 'ProviderConformance',
}

/**
 * testProvider checks the connected full-snapshot protocol without importing a test runner.
 * A rejecting factory is explicit so the suite proves failures cross the real provider boundary.
 */
export async function testProvider(
  createProvider: TaoDataProviderFactory,
  createRejectingProvider: TaoDataProviderFactory,
): Promise<void> {
  const run = ++providerConformanceRun
  const key = (name: string): string => `tao-provider-conformance-${run}-${name}`
  const provider = createProvider()
  const connect = (source: TaoDataProvider, storageKey: string): TaoDataConnection =>
    source.connect(providerContext(storageKey))

  assertProviderConformance(
    await connect(provider, key('empty')).load() === undefined,
    'load must return undefined for an empty storage key.',
  )

  const roundTrip = connect(provider, key('round-trip'))
  const roundTripSnapshot = '{"snapshot":"round-trip"}'
  await roundTrip.save(roundTripSnapshot)
  assertProviderConformance(
    await roundTrip.load() === roundTripSnapshot,
    'saved snapshots must round-trip exactly.',
  )

  const firstConnection = connect(provider, key('first-schema'))
  const secondConnection = connect(provider, key('second-schema'))
  await firstConnection.save('{"schema":"first"}')
  await secondConnection.save('{"schema":"second"}')
  assertProviderConformance(
    await firstConnection.load() === '{"schema":"first"}'
      && await secondConnection.load() === '{"schema":"second"}',
    'storage keys must remain isolated.',
  )

  const ordered = connect(provider, key('ordered'))
  await ordered.save('{"sequence":1}')
  await ordered.save('{"sequence":2}')
  assertProviderConformance(
    await ordered.load() === '{"sequence":2}',
    'later full snapshots must replace earlier snapshots in call order.',
  )

  const instanceKey = key('instance')
  const firstInstance = connect(createProvider(), instanceKey)
  const secondInstance = connect(createProvider(), instanceKey)
  await firstInstance.save('{"instance":"first"}')
  const secondStart = await secondInstance.load()
  assertProviderConformance(
    secondStart === undefined || secondStart === '{"instance":"first"}',
    'provider instances must be isolated or share one stateless storage boundary.',
  )
  await secondInstance.save('{"instance":"second"}')
  assertProviderConformance(
    await firstInstance.load() === (
      secondStart === undefined ? '{"instance":"first"}' : '{"instance":"second"}'
    ),
    'provider instances must not partially share state.',
  )

  let rejected = false
  try {
    await connect(createRejectingProvider(), key('rejection')).save('{"snapshot":"rejected"}')
  } catch {
    rejected = true
  }
  assertProviderConformance(rejected, 'save must propagate storage rejection.')
}

let providerConformanceRun = 0

function providerContext(storageKey: string): TaoDataProviderContext {
  return Object.freeze({
    configuration: Object.freeze({}),
    schema: conformanceSchema,
    storageKey,
  })
}

/** assertProviderConformance names the provider-contract category on top of the shared guard API. */
function assertProviderConformance(condition: boolean, message: string): asserts condition {
  RuntimeAssert.input(condition, `DataProvider conformance failed: ${message}`)
}

/** testDataConnection is the runtime harness's private, per-check snapshot connection. */
export function testDataConnection(initial?: string): TaoDataConnection {
  let stored = initial
  return {
    load: () => stored,
    referenceToken: reference => reference.id,
    resolveReference: reference => reference.token,
    save: value => {
      stored = value
    },
  }
}

/**
 * memoryKeyValueStorage is the runtime harness's in-memory host storage boundary. It exposes the
 * backing map so a check can seed and inspect it, and it deliberately omits the optional
 * `removeItem`: navigation restoration branches on that capability, and the absent branch is the
 * one most checks need. A check that wants deletion adds `removeItem` over `values` itself.
 */
export function memoryKeyValueStorage(
  values: Map<string, string> = new Map(),
): TaoKeyValueStorage & { values: Map<string, string> } {
  return {
    getItem: key => Promise.resolve(values.get(key) ?? null),
    setItem: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    values,
  }
}

/**
 * memoryDataProvider is the runtime harness's per-storage-key snapshot provider. It exposes the
 * backing map, and implements only `load` and `save`: the optional restoration and fill
 * capabilities are what individual checks vary, so they wrap this rather than configure it.
 */
export function memoryDataProvider(
  snapshots: Map<string, string> = new Map(),
): TaoDataProvider & { snapshots: Map<string, string> } {
  return {
    connect: ({ storageKey }) => ({
      load: () => snapshots.get(storageKey),
      save: value => {
        snapshots.set(storageKey, value)
      },
    }),
    snapshots,
  }
}

/** UnboundConnection surfaces use of a schema before an app mounts its configured datasource. */
export function UnboundConnection(schemaName: string): TaoDataConnection {
  const message = `Data schema '${schemaName}' has no bound provider.`
  return {
    load: () => {
      throw new UserInputError(message, { schema: schemaName })
    },
    save: () => {
      throw new UserInputError(message, { schema: schemaName })
    },
  }
}

/** platformKeyValueStorage exposes the shared host storage boundary to navigation persistence. */
export function platformKeyValueStorage(): TaoKeyValueStorage {
  const required = require('@react-native-async-storage/async-storage') as
    | TaoKeyValueStorage
    | { default: TaoKeyValueStorage }
  return 'default' in required ? required.default : required
}
