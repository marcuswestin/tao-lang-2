import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

const Values = TR.NativeValues

Describe('native dynamic value conversion', () => {
  Test('reads arbitrary nested EXIF and JSON shapes without guessing field types', () => {
    const metadata = { camera: 'Example', exposure: 0.008, tags: ['trip'], favorite: false }
    const value = Values.box(metadata)
    Expect(Values.keys(value)).toEqual(['camera', 'exposure', 'tags', 'favorite'])
    Expect(Values.text(Values.readKey(value, 'camera')!)).toBe('Example')
    Expect(Values.number(Values.readKey(value, 'exposure')!)).toBe(0.008)
    Expect(Values.boolean(Values.readKey(value, 'favorite')!)).toBe(false)
    const tags = Values.readKey(value, 'tags')!
    Expect(Values.kind(tags)).toBe('list')
    Expect(Values.length(tags)).toBe(1)
    Expect(Values.text(Values.readIndex(tags, 0)!)).toBe('trip')
    Expect(Values.unbox(value)).toBe(metadata)
    Expect(Values.box(metadata)).toBe(value)
  })

  Test('distinguishes present null and undefined from missing own keys and sparse entries', () => {
    const value = Values.box({ absent: undefined, empty: null, zero: 0, text: '' })
    Expect(Values.readKey(value, 'missing')).toBeNull()
    Expect(Values.readKey(value, 'toString')).toBeNull()
    Expect(Values.kind(Values.readKey(value, 'absent')!)).toBe('undefined')
    Expect(Values.kind(Values.readKey(value, 'empty')!)).toBe('null')
    Expect(Values.number(Values.readKey(value, 'zero')!)).toBe(0)
    Expect(Values.text(Values.readKey(value, 'text')!)).toBe('')
    const list: unknown[] = []
    list.length = 2
    list[1] = null
    const wrapped = Values.box(list)
    Expect(Values.readIndex(wrapped, 0)).toBeNull()
    Expect(Values.kind(Values.readIndex(wrapped, 1)!)).toBe('null')
    Expect(Values.readIndex(wrapped, 2)).toBeNull()
  })

  Test('reads live objects and preserves repeated and cyclic references', () => {
    const native: { count: number; self?: unknown } = { count: 1 }
    native.self = native
    const wrapped = Values.box(native)
    Expect(Values.readKey(wrapped, 'self')).toBe(wrapped)
    native.count = 2
    Expect(Values.number(Values.readKey(wrapped, 'count')!)).toBe(2)
  })

  Test('rejects wrong primitive reads, invalid indexes and forged references', () => {
    Expect(() => Values.number(Values.box('12'))).toThrow('finite number')
    Expect(() => Values.number(Values.box(Infinity))).toThrow('finite number')
    Expect(() => Values.text(Values.box(false))).toThrow('native text value')
    Expect(() => Values.boolean(Values.box(0))).toThrow('native boolean value')
    Expect(() => Values.keys(Values.box(null))).toThrow('native object value')
    Expect(() => Values.length(Values.box({}))).toThrow('native list value')
    for (const index of [-1, 0.5, Infinity, NaN]) {
      Expect(() => Values.readIndex(Values.box([]), index)).toThrow('non-negative integer')
    }
    Expect(() => Values.unbox({})).toThrow()
  })

  Test('classifies unmodeled JavaScript values without coercing or losing them', () => {
    const callable = () => undefined
    const token = Symbol('native')
    for (const [native, kind] of [[callable, 'function'], [token, 'symbol'], [1n, 'bigint']] as const) {
      const boxed = Values.box(native)
      Expect(Values.kind(boxed)).toBe(kind)
      Expect(Values.unbox(boxed)).toBe(native)
    }
  })

  Test('releasing a dynamic wrapper leaves its underlying content unchanged', () => {
    const native = { camera: 'Example' }
    const value = Values.box(native)
    Values.release(value)
    Expect(() => Values.unbox(value)).toThrow()
    const next = Values.box(native)
    Expect(next).not.toBe(value)
    Expect(Values.text(Values.readKey(next, 'camera')!)).toBe('Example')
  })
})
