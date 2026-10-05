import { RuntimeAssert } from './TR-assert'
import { createNativeReferenceType, type NativeReference } from './TR-native-references'

export type NativeValueKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'list'
  | 'object'
  | 'function'
  | 'bigint'
  | 'symbol'

/** Dynamic results remain checked bridge values, rather than introducing an unchecked Tao type. */
const references = createNativeReferenceType<unknown>('NativeValue', (_value): _value is unknown => true)

function objectValue(value: NativeReference<unknown>): object {
  const native = references.unwrap(value)
  RuntimeAssert.input(native !== null && typeof native === 'object', 'Read object keys from a native object value.')
  return native
}

function listValue(value: NativeReference<unknown>): unknown[] {
  const native = references.unwrap(value)
  RuntimeAssert.input(Array.isArray(native), 'Read list entries from a native list value.')
  return native
}

/** Shared inspection for arbitrary native records and JSON, with no package-specific behavior. */
export const nativeValueControls = Object.freeze({
  box: (value: unknown): NativeReference<unknown> => references.wrap(value),
  unbox: (value: unknown): unknown => references.unwrap(value),
  release: (value: unknown): void => references.release(value),
  kind(value: NativeReference<unknown>): NativeValueKind {
    const native = references.unwrap(value)
    if (native === null) {
      return 'null'
    }
    if (Array.isArray(native)) {
      return 'list'
    }
    const kind = typeof native
    return kind === 'string' ? 'text' : kind
  },
  keys: (value: NativeReference<unknown>): string[] => Object.keys(objectValue(value)),
  readKey(value: NativeReference<unknown>, key: string): NativeReference<unknown> | null {
    const native = objectValue(value)
    return Object.hasOwn(native, key)
      ? references.wrap((native as Record<string, unknown>)[key])
      : null
  },
  length: (value: NativeReference<unknown>): number => listValue(value).length,
  readIndex(value: NativeReference<unknown>, index: number): NativeReference<unknown> | null {
    RuntimeAssert.input(
      Number.isSafeInteger(index) && index >= 0,
      'A native list index must be a non-negative integer.',
    )
    const native = listValue(value)
    return index < native.length && Object.hasOwn(native, index) ? references.wrap(native[index]) : null
  },
  text(value: NativeReference<unknown>): string {
    const native = references.unwrap(value)
    RuntimeAssert.input(typeof native === 'string', 'Read text from a native text value.')
    return native
  },
  number(value: NativeReference<unknown>): number {
    const native = references.unwrap(value)
    RuntimeAssert.input(
      typeof native === 'number' && Number.isFinite(native),
      'Read a finite number from a native number value.',
    )
    return native
  },
  boolean(value: NativeReference<unknown>): boolean {
    const native = references.unwrap(value)
    RuntimeAssert.input(typeof native === 'boolean', 'Read a boolean from a native boolean value.')
    return native
  },
})
