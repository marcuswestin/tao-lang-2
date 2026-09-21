import { RuntimeAssert } from './TR-assert'
import type { TaoDataSchema } from './TR-data'

export type RuntimeEntityMetadata = {
  entity: string
  generation: number
  id: string
  schema: TaoDataSchema
}

export type TaoEntityReferenceSnapshot = Readonly<{
  entity: string
  provider: string
  schema: string
  token: string
}>

const runtimeEntityMetadata = new WeakMap<RuntimeEntityHandle, RuntimeEntityMetadata>()

export class RuntimeEntityHandle {
  constructor(
    schema: TaoDataSchema,
    entity: string,
    id: string,
    generation: number,
  ) {
    runtimeEntityMetadata.set(this, { entity, generation, id, schema })
    Object.defineProperty(this, 'Id', { enumerable: true, get: () => id })
    const definition = schema.definition.entities[entity]
    const fields = { ...(definition?.fields ?? {}), ...(definition?.inverseFields ?? {}) }
    for (const name of Object.keys(fields)) {
      Object.defineProperty(this, name, {
        enumerable: true,
        get: () => schema.read(this, name),
      })
    }
  }
}

export function entityHandle(value: unknown): RuntimeEntityHandle | undefined {
  return value instanceof RuntimeEntityHandle ? value : undefined
}

export function metadataOf(handle: RuntimeEntityHandle): RuntimeEntityMetadata {
  const metadata = runtimeEntityMetadata.get(handle)
  RuntimeAssert.defined(metadata, 'a Tao data entity handle carries its runtime metadata')
  return metadata
}

export function handleKey(entity: string, id: string): string {
  return `${entity}\u0000${id}`
}
