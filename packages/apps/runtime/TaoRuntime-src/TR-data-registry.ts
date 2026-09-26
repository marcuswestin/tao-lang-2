import { Arrays } from './core/RuntimeCore'
import { RuntimeAssert } from './TR-assert'
import type { TaoConfiguredDatasource, TaoDataSchema, TaoDatasourceDeclaration } from './TR-data'
import { entityHandle, metadataOf, type TaoEntityReferenceSnapshot } from './TR-data-entity'
import { UserInputError } from './TR-errors'
import { runtimeListeners } from './TR-listeners'
import { TestWorld } from './TR-test-world'

export type DataStatus = 'error' | 'loading' | 'ready' | 'unauthorized'

let testMode = false
let testDeclarations = new WeakMap<TaoDataSchema, WeakMap<TaoDatasourceDeclaration, TaoDatasourceDeclaration>>()
let testBoundSchemas = new WeakSet<TaoDataSchema>()
let testValueIds = new Map<unknown, number>()
const schemas = new Set<TaoDataSchema>()
const scopedSchemas = new WeakSet<TaoDataSchema>()
const globalListeners = runtimeListeners()
let globalRevision = 0

export type TaoDataCapture = Readonly<{
  entries: readonly Readonly<{ key: string; snapshot: string }>[]
}>

export function isDataTestMode(): boolean {
  return testMode
}

export function registerDataSchema(schema: TaoDataSchema, scoped = false): void {
  schemas.add(schema)
  if (scoped) {
    scopedSchemas.add(schema)
  }
}

/** Mounted app scopes release their schemas when their host unmounts. */
export function unregisterDataSchema(schema: TaoDataSchema): void {
  schemas.delete(schema)
}

/** interactionEntityHandles returns stored live rows in active-schema then schema query order. */
export function interactionEntityHandles(
  entity: string,
  scope?: { ownsStore(store: TaoDataSchema): boolean },
): readonly unknown[] {
  return [...schemas].filter(schema => scope ? scope.ownsStore(schema) : !scopedSchemas.has(schema)).flatMap(schema =>
    schema.interactionCandidates(entity)
  )
}

export function serializeEntityReference(value: unknown): TaoEntityReferenceSnapshot | undefined {
  const handle = entityHandle(value)
  return handle ? metadataOf(handle).schema.serializeReference(handle) : undefined
}

export function restoreEntityReference(
  reference: TaoEntityReferenceSnapshot,
  scope?: { ownsStore(store: TaoDataSchema): boolean },
): unknown {
  for (const schema of schemas) {
    if (scope ? !scope.ownsStore(schema) : scopedSchemas.has(schema)) {
      continue
    }
    const handle = schema.restoreReference(reference)
    if (handle) {
      return handle
    }
  }
  throw new UserInputError(`No active datasource matches restored entity schema '${reference.schema}'.`, {
    schema: reference.schema,
  })
}

function testValueIdentity(value: unknown): number {
  let id = testValueIds.get(value)
  if (id === undefined) {
    id = testValueIds.size + 1
    testValueIds.set(value, id)
  }
  return id
}

/** Stable for equivalent evaluated configuration values, distinct for adapter objects by identity. */
function testConfigurationKey(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return ['number', String(value)]
  }
  if (typeof value === 'undefined' || typeof value === 'bigint') {
    return [typeof value, String(value)]
  }
  if (Array.isArray(value)) {
    return ['array', value.map(testConfigurationKey)]
  }
  if (
    typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    return [
      'record',
      Arrays.sorted(Object.keys(value)).map(
        key => [key, testConfigurationKey((value as Record<string, unknown>)[key])],
      ),
    ]
  }
  return ['identity', testValueIdentity(value)]
}

export function bindConfiguredDataSchema(
  schema: TaoDataSchema,
  source: TaoConfiguredDatasource,
  storageName?: string,
): void {
  if (testMode) {
    // Configuration mistakes must fail the behavior test that mounts them, not the first
    // production mount, so the runtime-owned validation runs here even though the provider is
    // never connected under test.
    schema.validateConfigured(source, storageName)
    // Query-driven fills still bind their deterministic adapter. Other providers bind a stand-in
    // under the same configuration and storage key, so a patch or provider switch really rebinds.
    if (source.declaration.provider.fills !== undefined) {
      schema.bindConfigured(source, storageName)
      testBoundSchemas.add(schema)
      return
    }
    let declarations = testDeclarations.get(schema)
    if (declarations === undefined) {
      declarations = new WeakMap()
      testDeclarations.set(schema, declarations)
    }
    let declaration = declarations.get(source.declaration)
    if (declaration === undefined) {
      const granular = source.declaration.provider.testWriteRecovery === true
      const networkMode = source.declaration.provider.testNetwork ?? (granular ? 'remote' : 'local')
      const providerIdentity = source.declaration.canonicalIdentity?.canonical
        ?? `instance:${testValueIdentity(source.declaration.identity)}`
      // Fixtures can create rows before the app binds its provider. Carry those rows into the
      // first stand-in connection; later configuration changes use the selected store's state.
      let initialSnapshot = testBoundSchemas.has(schema) ? undefined : schema.captureSnapshot()
      declaration = Object.freeze({
        ...source.declaration,
        provider: {
          connect: context => {
            const connection = TestWorld.connection(
              granular,
              JSON.stringify([
                context.schema.name,
                providerIdentity,
                context.storageKey,
                testConfigurationKey(context.configuration),
              ]),
              initialSnapshot,
              networkMode,
            )
            initialSnapshot = undefined
            return connection
          },
        },
      })
      declarations.set(source.declaration, declaration)
    }
    const testDeclaration = declaration
    const testSource: TaoConfiguredDatasource = Object.freeze({
      ...source,
      declaration: testDeclaration,
      evaluate: () => testSource,
    })
    schema.bindConfigured(testSource, storageName)
    testBoundSchemas.add(schema)
    return
  }
  schema.bindConfigured(source, storageName)
}

/** settleAllDataSchemas waits out every schema's load, in-flight fills, and queued saves. */
export async function settleAllDataSchemas(): Promise<void> {
  for (const schema of schemas) {
    await schema.settle()
  }
}

export function captureDataSchemas(): TaoDataCapture {
  const occurrences = new Map<string, number>()
  return Object.freeze({
    entries: Object.freeze([...schemas].map(schema => {
      const identity = schema.captureIdentity()
      const occurrence = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrence + 1)
      return Object.freeze({ key: JSON.stringify([identity, occurrence]), snapshot: schema.captureSnapshot() })
    })),
  })
}

export async function restoreDataSchemas(captured: TaoDataCapture): Promise<void> {
  const byKey = new Map(captured.entries.map(entry => [entry.key, entry.snapshot]))
  const occurrences = new Map<string, number>()
  for (const schema of schemas) {
    const identity = schema.captureIdentity()
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    const snapshot = byKey.get(JSON.stringify([identity, occurrence]))
    if (snapshot !== undefined) {
      await schema.restoreCapturedSnapshot(snapshot)
    }
  }
}

export function canResetAllDataSchemas(): boolean {
  return schemas.size > 0 && [...schemas].every(schema => schema.canReset())
}

/** resetAllDataSchemas captures every schema before the first destructive provider call. */
export async function resetAllDataSchemas(): Promise<TaoDataCapture> {
  RuntimeAssert(canResetAllDataSchemas(), 'every active datasource supports reset before a recovery reset runs')
  const backup = captureDataSchemas()
  try {
    for (const schema of schemas) {
      await schema.resetFromRecovery()
    }
    return backup
  } catch (error) {
    try {
      await restoreDataSchemas(backup)
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        'Datasource reset failed and its backup could not be fully restored.',
      )
    }
    throw error
  }
}

export function subscribeAll(listener: () => void): () => void {
  return globalListeners.subscribe(listener)
}

export function revision(): number {
  return globalRevision
}

export function beginTest(): void {
  testMode = true
  TestWorld.begin()
  testDeclarations = new WeakMap()
  testBoundSchemas = new WeakSet()
  testValueIds = new Map()
  for (const schema of schemas) {
    schema.configure(TestWorld.connection(), 'test')
  }
}

export function endTest(): void {
  testMode = false
  TestWorld.end()
}

export function emitDataChange(localListeners: Iterable<() => void>): void {
  globalRevision += 1
  for (const listener of localListeners) {
    listener()
  }
  globalListeners.notify()
}
