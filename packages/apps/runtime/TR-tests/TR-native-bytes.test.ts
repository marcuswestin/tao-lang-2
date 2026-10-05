import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('native byte conversion', () => {
  Test('round trips empty and full-range numeric lists without sharing mutable storage', () => {
    Expect(TR.NativeBytes.toList(TR.NativeBytes.fromList([]))).toEqual([])
    const values = [0, 127, 128, 255]
    const bytes = TR.NativeBytes.fromList(values)
    values[0] = 1
    Expect(TR.NativeBytes.toList(bytes)).toEqual([0, 127, 128, 255])
    const copied = TR.NativeBytes.toList(bytes)
    bytes[0] = 2
    Expect(copied).toEqual([0, 127, 128, 255])
  })

  Test('copies only a byte view rather than exposing the rest of its backing buffer', () => {
    const bytes = new Uint8Array([91, 1, 2, 92])
    Expect(TR.NativeBytes.toList(bytes.subarray(1, 3))).toEqual([1, 2])
  })

  Test('copies the values it validated when native getters or iterators change between reads', () => {
    let reads = 0
    const getter = [0]
    Object.defineProperty(getter, '0', { get: () => reads++ === 0 ? 127 : 256 })
    Expect(TR.NativeBytes.toList(TR.NativeBytes.fromList(getter))).toEqual([127])

    let iterations = 0
    const iterator = [0]
    Object.defineProperty(iterator, Symbol.iterator, {
      value: function*() {
        yield iterations++ === 0 ? 64 : 256
      },
    })
    Expect(TR.NativeBytes.toList(TR.NativeBytes.fromList(iterator))).toEqual([64])
  })

  Test('rejects values that typed arrays would silently coerce or truncate', () => {
    for (const value of [-1, 256, 1.5, NaN, Infinity, '2', null, undefined]) {
      Expect(() => TR.NativeBytes.fromList([value] as number[])).toThrow('integer from 0 to 255')
    }
    const sparse = new Array<number>(1)
    Expect(() => TR.NativeBytes.fromList(sparse)).toThrow('integer from 0 to 255')
    Expect(() => TR.NativeBytes.fromList(new Uint8Array([1]) as unknown as number[])).toThrow('list of numbers')
    Expect(() => TR.NativeBytes.toList(new Uint16Array([256]) as unknown as Uint8Array)).toThrow('byte buffer')
  })
})
