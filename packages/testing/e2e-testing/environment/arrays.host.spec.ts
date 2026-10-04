import { expect, test } from '@playwright/test'
import { Arrays as SharedArrays } from '@shared'
import { Arrays as SharedCoreArrays } from '@shared/core'
import { Arrays as RuntimeArrays } from '@tao/runtime/core'

test('RuntimeCore arrays order frozen inputs into independent results through shared and runtime cores', () => {
  const input = Object.freeze([
    { group: 2, name: 'second' },
    { group: 1, name: 'first' },
    { group: 2, name: 'third' },
  ])

  expect(SharedArrays).toBe(RuntimeArrays)
  expect(SharedCoreArrays).toBe(RuntimeArrays)

  const sorted = SharedArrays.sorted(input, (left, right) => left.group - right.group)
  const reversed = RuntimeArrays.reversed(input)

  expect(input.map(item => item.name)).toEqual(['second', 'first', 'third'])
  expect(sorted.map(item => item.name)).toEqual(['first', 'second', 'third'])
  expect(reversed.map(item => item.name)).toEqual(['third', 'first', 'second'])
  expect(sorted).not.toBe(input)
  expect(reversed).not.toBe(input)
})

test('RuntimeCore arrays retain explicit in-place identity', () => {
  const mutable = ['second', 'first']
  const sortedMutable = RuntimeArrays.sortInPlace(mutable)

  expect(sortedMutable).toBe(mutable)
  expect(mutable).toEqual(['first', 'second'])
})
