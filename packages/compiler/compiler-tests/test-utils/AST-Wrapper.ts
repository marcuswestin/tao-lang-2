import { AST, Langium } from '@parser'
import { expect } from 'bun:test'

/** wrap returns a proxy-based wrapper enabling type-safe AST traversal for test assertions. */
export function wrap<T extends AST.Node>(node: T): Wrapped<T> {
  const methods = {
    expect(key: string) {
      return expect((node as Record<string, unknown>)[key])
    },
    /** match asserts `node` satisfies `shape` via deep partial `toMatchObject` semantics. */
    match(shape: unknown) {
      expect(node).toMatchObject(shape as Record<string, unknown>)
    },
    unwrap() {
      return node
    },
  }

  return new Proxy(methods as unknown as Wrapped<T>, {
    get(target, prop) {
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (Object.hasOwn(target, prop)) {
        const value = (target as Record<string, unknown>)[prop]
        return typeof value === 'function' ? value.bind(target) : value
      }

      if (typeof prop === 'string' && prop.startsWith('as_')) {
        expect(node.$type).toBe(prop.slice(3))
        return wrap(node)
      }

      const child = (node as Record<string, unknown>)[prop]

      if (prop === 'then' && child === undefined) {
        return undefined
      }

      expect(child, `Property '${String(prop)}' is undefined`).toBeDefined()

      if (child !== null && typeof child === 'object' && '$type' in child) {
        return wrap(child as AST.Node)
      }

      if (child !== null && typeof child === 'object' && 'ref' in child) {
        const ref = child as Langium.Reference<AST.Node>
        expect(ref.ref, `Reference '${String(prop)}' is unresolved`).toBeDefined()
        return wrap(ref.ref!)
      }

      if (Array.isArray(child)) {
        return wrapArray(child)
      }

      return child
    },
  })
}

function wrapElement(el: unknown): unknown {
  return el && typeof el === 'object' && '$type' in el ? wrap(el as AST.Node) : el
}

function wrapArray<T>(array: unknown[]): WrappedArray<T> {
  return new Proxy(array as WrappedArray<T>, {
    get(target, prop) {
      switch (prop) {
        case 'first':
          expect(target[0], `Array is empty, cannot get .first`).toBeDefined()
          return wrapElement(target[0])
        case 'second':
          expect(target[1], `Array has less than 2 elements, cannot get .second`).toBeDefined()
          return wrapElement(target[1])
        case 'last':
          expect(target.length > 0, `Array is empty, cannot get .last`).toBe(true)
          return wrapElement(target[target.length - 1])
        case 'only':
          expect(target, `Array expected exactly 1 element, got ${target.length}`).toHaveLength(1)
          return wrapElement(target[0])
        case 'match':
          return (shape: unknown[]) => {
            expect(target).toMatchObject(shape)
          }
        default: {
          const index = typeof prop === 'string' ? Number(prop) : NaN
          if (!Number.isNaN(index) && Number.isInteger(index)) {
            return wrapElement(target[index])
          }
          return (target as unknown as Record<string | symbol, unknown>)[prop]
        }
      }
    },
  })
}

type ExtractByType<T, TypeName extends string> = T extends { $type: TypeName } ? T : never
type TypeNames<T> = T extends { $type: infer U extends string } ? U : never
type OwnKeys<T> = Exclude<keyof T, keyof AST.Node>
type IsUnion<T, U = T> = T extends T ? ([U] extends [T] ? false : true) : never
type IsSingleType<T> = IsUnion<T> extends true ? false : true

type WrappedArray<T> = T[] & {
  readonly first: T
  readonly second: T
  readonly last: T
  /** only asserts the array has exactly one element and returns that element. */
  readonly only: T
  /** match asserts the array satisfies `shape` via deep partial `toMatchObject` semantics. */
  match(shape: readonly unknown[]): void
}

type WrappedProp<T> = WrappedPropInner<NonNullable<T>>
type WrappedPropInner<T> = [T] extends [AST.Node] ? Wrapped<T>
  : T extends Langium.Reference<infer R extends AST.Node> ? Wrapped<R>
  : T extends readonly (infer E)[] ? [E] extends [AST.Node] ? WrappedArray<Wrapped<E>> : T
  : T

type WrappedProps<T extends AST.Node> = { readonly [K in OwnKeys<T>]: WrappedProp<T[K]> }

type AsGetters<T extends AST.Node> = {
  readonly [TypeName in TypeNames<T> as `as_${TypeName}`]: Wrapped<ExtractByType<T, TypeName>>
}

type Expectation<T> = ReturnType<typeof expect<T>>

export type Wrapped<T extends AST.Node> =
  & (IsSingleType<T> extends true ? {
      expect<K extends OwnKeys<T>>(key: K): Expectation<T[K]>
      unwrap(): T
    } & WrappedProps<T>
    : AsGetters<T>)
  & {
    /** match asserts the node satisfies `shape` via deep partial `toMatchObject` semantics. */
    match(shape: unknown): void
  }
