import { RuntimeAssert } from './TR-assert'

/** Copies bridge byte values; native buffers themselves remain reference-backed resources. */
export const nativeByteControls = Object.freeze({
  fromList(values: readonly number[]): Uint8Array<ArrayBuffer> {
    RuntimeAssert.input(Array.isArray(values), 'Native bytes require a list of numbers.')
    const checked: number[] = []
    for (const value of values) {
      RuntimeAssert.input(
        typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255,
        'Every native byte must be an integer from 0 to 255.',
      )
      checked.push(value)
    }
    return Uint8Array.from(checked)
  },
  toList(bytes: Uint8Array): number[] {
    RuntimeAssert.input(bytes instanceof Uint8Array, 'Copy native bytes from a byte buffer.')
    return Array.from(bytes)
  },
})
