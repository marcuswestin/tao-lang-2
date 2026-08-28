import type {
  TaoDataConnection,
  TaoDataProvider,
  TaoDataProviderContext,
  TaoDataProviderFactory,
  TaoDataSchemaDefinition,
} from './TR-data'

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

function assertProviderConformance(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`DataProvider conformance failed: ${message}`)
  }
}

/** testDataConnection is the runtime harness's private, per-check snapshot connection. */
export function testDataConnection(initial?: string): TaoDataConnection {
  let stored = initial
  return {
    load: () => stored,
    save: value => {
      stored = value
    },
  }
}

/** UnboundConnection surfaces use of a schema before an app mounts its configured datasource. */
export function UnboundConnection(schemaName: string): TaoDataConnection {
  const message = `Data schema '${schemaName}' has no bound provider.`
  return {
    load: () => {
      throw new Error(message)
    },
    save: () => {
      throw new Error(message)
    },
  }
}
