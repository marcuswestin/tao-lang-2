import { RuntimeAssert } from './TR-assert'
import type { TaoConfiguredDatasource, TaoDataSchema } from './TR-data'
import { entityHandle, metadataOf, type TaoEntityReferenceSnapshot } from './TR-data-entity'
import { testDataConnection } from './TR-data-provider'
import { UserInputError } from './TR-errors'

export type DataStatus = 'error' | 'loading' | 'ready' | 'unauthorized'

let testMode = false
const schemas = new Set<TaoDataSchema>()
const globalListeners = new Set<() => void>()
let globalRevision = 0
let lastResetBackup: TaoDataCapture | undefined

export type TaoDataCapture = Readonly<{
  entries: readonly Readonly<{ key: string; snapshot: string }>[]
}>

export function isDataTestMode(): boolean {
  return testMode
}

export function registerDataSchema(schema: TaoDataSchema): void {
  schemas.add(schema)
}

export function serializeEntityReference(value: unknown): TaoEntityReferenceSnapshot | undefined {
  const handle = entityHandle(value)
  return handle ? metadataOf(handle).schema.serializeReference(handle) : undefined
}

export function restoreEntityReference(reference: TaoEntityReferenceSnapshot): unknown {
  for (const schema of schemas) {
    const handle = schema.restoreReference(reference)
    if (handle) {
      return handle
    }
  }
  throw new UserInputError(`No active datasource matches restored entity schema '${reference.schema}'.`, {
    schema: reference.schema,
  })
}

export function bindConfiguredDataSchema(
  schema: TaoDataSchema,
  source: TaoConfiguredDatasource,
): void {
  if (testMode) {
    // Configuration mistakes must fail the behavior test that mounts them, not the first
    // production mount, so the runtime-owned validation runs here even though the provider is
    // never connected under test.
    schema.validateConfigured(source)
    // A snapshot provider stays replaced by the fresh test Memory store. A fill-capable provider
    // binds anyway: fills are how a query-driven datasource has any rows at all, and determinism
    // is the running app variant's responsibility — a test runs the variant whose adapter is a
    // deterministic stub, never the network (Decisions §11, §16).
    if (source.declaration.provider.fills === undefined) {
      return
    }
  }
  schema.bindConfigured(source)
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
  lastResetBackup = backup
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

export function lastDataResetBackup(): TaoDataCapture | undefined {
  return lastResetBackup
}

export function subscribeAll(listener: () => void): () => void {
  globalListeners.add(listener)
  return () => globalListeners.delete(listener)
}

export function revision(): number {
  return globalRevision
}

export function beginTest(): void {
  testMode = true
  for (const schema of schemas) {
    schema.configure(testDataConnection(), 'test')
  }
}

export function endTest(): void {
  testMode = false
}

export function emitDataChange(localListeners: Iterable<() => void>): void {
  globalRevision += 1
  for (const listener of localListeners) {
    listener()
  }
  for (const listener of globalListeners) {
    listener()
  }
}
