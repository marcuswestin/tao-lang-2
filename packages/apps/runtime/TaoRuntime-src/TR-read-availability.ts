import type { TaoEntityAvailability } from './TR-data'

const availability = new WeakMap<object, TaoEntityAvailability>()

/** Account can remain none while its read boundary still explains why it is unavailable. */
export function withReadAvailability<ValueT extends object>(value: ValueT, state: TaoEntityAvailability): ValueT {
  availability.set(value, state)
  return value
}

export function readAvailability(value: unknown): TaoEntityAvailability | undefined {
  return typeof value === 'object' && value !== null ? availability.get(value) : undefined
}
