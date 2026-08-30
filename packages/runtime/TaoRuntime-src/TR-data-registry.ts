import type { TaoDataSchema } from './TR-data'
import { MemoryProvider } from './TR-data-provider'

export type DataStatus = 'error' | 'loading' | 'ready' | 'unauthorized'

let testMode = false
const schemas = new Set<TaoDataSchema>()
const activeTestSchemas = new Set<TaoDataSchema>()
const globalListeners = new Set<() => void>()
let globalRevision = 0

export function isDataTestMode(): boolean {
  return testMode
}

export function registerDataSchema(schema: TaoDataSchema): void {
  schemas.add(schema)
}

export function bindConfiguredDataSchema(
  schema: TaoDataSchema,
  ...binding: Parameters<TaoDataSchema['bindConfigured']>
): void {
  if (testMode) {
    activeTestSchemas.add(schema)
    // A snapshot provider stays replaced by the fresh test Memory store. A fill-capable provider
    // binds anyway: fills are how a query-driven datasource has any rows at all, and determinism
    // is the running app variant's responsibility — a test runs the variant whose adapter is a
    // deterministic stub, never the network (Decisions §11, §16).
    if (binding[0]?.provider.fill === undefined) {
      return
    }
  }
  schema.bindConfigured(...binding)
}

/** settleAllDataSchemas waits out every schema's load, in-flight fills, and queued saves. */
export async function settleAllDataSchemas(): Promise<void> {
  for (const schema of schemas) {
    await schema.settle()
  }
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
  activeTestSchemas.clear()
  for (const schema of schemas) {
    schema.configure(MemoryProvider(), 'test')
  }
}

export function endTest(): void {
  testMode = false
  activeTestSchemas.clear()
}

export function setTestStatus(status: DataStatus, message = ''): void {
  if (activeTestSchemas.size === 0) {
    throw new Error('A `data` step requires the running app to declare a Datasource.')
  }
  for (const schema of activeTestSchemas) {
    schema.setStatus(status, message)
  }
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
