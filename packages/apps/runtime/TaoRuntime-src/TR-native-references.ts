import { RuntimeAssert } from './TR-assert'

declare const nativeReferenceBrand: unique symbol

// Interface merging retains covariance in declarations without an instance field or native payload.
interface NativeReferenceValue<T> {
  readonly [nativeReferenceBrand]: () => T
}

class NativeReferenceValue<T> {
  toJSON(): never {
    RuntimeAssert.input(false, 'A native reference cannot be serialized. Store ordinary data from it instead.')
  }
}

/** A retained native value whose payload is accessible only through its owning descriptor. */
export type NativeReference<T> = NativeReferenceValue<T>

export type NativeReferenceType<T> = {
  wrap(value: T): NativeReference<T>
  is(value: unknown): value is NativeReference<T>
  unwrap(value: unknown): T
  release(value: unknown): void
  get(value: unknown, property: string | symbol): unknown
  set(value: unknown, property: string | symbol, next: unknown): void
  invoke(value: unknown, method: string | symbol, args: readonly unknown[]): unknown
}

/** Each module owns its descriptor; a display name never determines reference identity. */
export function createNativeReferenceType<T>(
  name: string,
  accepts: (value: unknown) => value is T,
): NativeReferenceType<T> {
  return createNativeReferenceGroup().define(name, accepts)
}

/** A module-owned family shares native identity while retaining checked descriptor membership. */
export function createNativeReferenceGroup() {
  type Descriptor = NativeReferenceType<unknown>
  type Definition = { name: string; accepts(value: unknown): boolean; parents: readonly Descriptor[] }
  type Entry = { value: unknown; members: Set<Descriptor> }
  const definitions = new WeakMap<Descriptor, Definition>()
  const retained = new WeakMap<object, Entry>()
  const expired = new WeakMap<object, ReadonlySet<Descriptor>>()
  const canonical = new WeakMap<object, NativeReference<unknown>>()

  return {
    define<T>(
      name: string,
      accepts: (value: unknown) => value is T,
      parents: readonly Descriptor[] = [],
    ): NativeReferenceType<T> {
      const declaredParents = Array.from(parents)
      const ancestry = new Set<Descriptor>()
      const visiting = new Set<Descriptor>()

      function visit(parent: Descriptor): void {
        RuntimeAssert.input(!visiting.has(parent), `The ${name} native reference parents contain a cycle.`)
        if (ancestry.has(parent)) {
          return
        }
        const definition = definitions.get(parent)
        RuntimeAssert.input(
          definition !== undefined,
          `The ${name} native reference parents must belong to the same group.`,
        )
        visiting.add(parent)
        for (const ancestor of definition.parents) {
          visit(ancestor)
        }
        visiting.delete(parent)
        ancestry.add(parent)
      }
      for (const parent of declaredParents) {
        visit(parent)
      }

      function unwrap(value: unknown): T {
        RuntimeAssert.input(isObject(value), `Use a ${name} native reference for this operation.`)
        const releasedMembers = expired.get(value)
        if (releasedMembers !== undefined) {
          RuntimeAssert.input(releasedMembers.has(descriptor), `Use a ${name} native reference for this operation.`)
          RuntimeAssert.input(false, `This ${name} native reference has been released.`)
        }
        const entry = retained.get(value)
        RuntimeAssert.input(
          entry !== undefined && entry.members.has(descriptor),
          `Use a ${name} native reference for this operation.`,
        )
        return entry.value as T
      }

      const descriptor: NativeReferenceType<T> = {
        is(value): value is NativeReference<T> {
          return isObject(value) && retained.get(value)?.members.has(descriptor) === true
        },
        wrap(value) {
          RuntimeAssert.input(accepts(value), `The native value is not valid for ${name}.`)
          // Validate all declared views before mutating an existing wrapper's memberships.
          for (const ancestor of ancestry) {
            const definition = definitions.get(ancestor)!
            RuntimeAssert.input(definition.accepts(value), `The native value is not valid for ${definition.name}.`)
          }
          if (isObject(value)) {
            const known = canonical.get(value)
            if (known !== undefined) {
              const entry = retained.get(known)!
              entry.members.add(descriptor)
              for (const ancestor of ancestry) {
                entry.members.add(ancestor)
              }
              return known as NativeReference<T>
            }
          }
          const reference = new NativeReferenceValue<T>()
          Object.freeze(reference)
          retained.set(reference, { value, members: new Set([descriptor, ...ancestry]) })
          if (isObject(value)) {
            canonical.set(value, reference)
          }
          return reference
        },
        unwrap,
        release(value) {
          RuntimeAssert.input(isObject(value), `Use a ${name} native reference for this operation.`)
          const releasedMembers = expired.get(value)
          if (releasedMembers !== undefined) {
            RuntimeAssert.input(releasedMembers.has(descriptor), `Use a ${name} native reference for this operation.`)
            return
          }
          const payload = unwrap(value)
          const entry = retained.get(value)!
          retained.delete(value)
          expired.set(value, entry.members)
          if (isObject(payload)) {
            canonical.delete(payload)
          }
        },
        get(value, property) {
          const payload = unwrap(value)
          return Reflect.get(Object(payload), property, payload)
        },
        set(value, property, next) {
          const payload = unwrap(value)
          RuntimeAssert.input(
            Reflect.set(Object(payload), property, next, payload),
            `The ${name} native property '${String(property)}' cannot be changed.`,
          )
        },
        invoke(value, method, args) {
          const payload = unwrap(value)
          const member = Reflect.get(Object(payload), method, payload)
          RuntimeAssert.input(
            typeof member === 'function',
            `The ${name} native method '${String(method)}' is not available.`,
          )
          return Reflect.apply(member, payload, args)
        },
      }
      definitions.set(descriptor, { name, accepts, parents: declaredParents })
      return descriptor
    },
  }
}

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}
