import { Describe, Expect, Test } from '@shared/test'
import {
  allocateInteractionKeys,
  reservedInteractionAllocationKeys,
} from '../TaoRuntime-src/TR-interaction-allocation'

Describe('TR.Interaction allocation', () => {
  Test('allocates by canonical identity rather than render order', () => {
    const forward = allocateInteractionKeys([
      { identity: 'project', label: 'Archive' },
      { identity: 'archive', label: 'Archive' },
      { identity: 'draft', label: 'Archive' },
    ])
    const reversed = allocateInteractionKeys([
      { identity: 'draft', label: 'Archive' },
      { identity: 'archive', label: 'Archive' },
      { identity: 'project', label: 'Archive' },
    ])

    Expect(forward).toEqual({ archive: 'a', draft: 'r', project: 'c' })
    Expect(reversed).toEqual(forward)
    Expect(Object.isFrozen(forward)).toBe(true)
  })

  Test('preserves valid identity assignments across reorders and admits a new identity afterward', () => {
    const previous = allocateInteractionKeys([
      { identity: 'zebra', label: 'Alpha' },
      { identity: 'zulu', label: 'Alpha' },
    ])
    const reordered = allocateInteractionKeys(
      [
        { identity: 'zulu', label: 'Alpha' },
        { identity: 'aardvark', label: 'Alpha' },
        { identity: 'zebra', label: 'Alpha' },
      ],
      { previous },
    )

    Expect(previous).toEqual({ zebra: 'a', zulu: 'l' })
    Expect(reordered).toEqual({ aardvark: 'p', zebra: 'a', zulu: 'l' })
    Expect(Object.keys(reordered)).toEqual(['aardvark', 'zebra', 'zulu'])
  })

  Test('segments and locale-folds Unicode graphemes without allocating emoji or punctuation', () => {
    const assignments = allocateInteractionKeys(
      [
        { identity: 'istanbul', label: 'Istanbul' },
        { identity: 'resume', label: 'E\u0301lan ✅' },
        { identity: 'tokyo', label: '👩🏽‍💻 東京' },
      ],
      { locale: 'tr' },
    )

    Expect(assignments).toEqual({ istanbul: 'ı', resume: 'é', tokyo: '東' })
  })

  Test('excludes bare accelerators while keeping modifier chords in their distinct namespace', () => {
    const assignments = allocateInteractionKeys(
      [
        { identity: 'finish', label: 'Finish' },
        { identity: 'kilo', label: 'Kilo' },
        { identity: 'projects', label: 'Projects' },
      ],
      { explicitKeys: ['f', 'primary+p'] },
    )

    Expect(reservedInteractionAllocationKeys.has('primary+k')).toBe(true)
    Expect(assignments).toEqual({ finish: 'i', kilo: 'k', projects: 'p' })
  })

  Test('uses deterministic two-letter sequences after colliding label letters are exhausted', () => {
    const assignments = allocateInteractionKeys([
      { identity: 'one', label: 'A' },
      { identity: 'three', label: 'A' },
      { identity: 'two', label: 'A' },
    ])

    Expect(assignments).toEqual({ one: 'a', three: 'ba', two: 'bb' })
  })

  Test('releases a deterministic continuation prefix when every single ASCII letter is occupied', () => {
    const candidates = Array.from({ length: 26 }, (_, index) => ({
      identity: `letter-${String.fromCharCode(97 + index)}`,
      label: String.fromCharCode(65 + index),
    }))
    candidates.push({ identity: 'overflow', label: 'A' })

    const assignments = allocateInteractionKeys(candidates)
    const keys = Object.values(assignments)

    Expect(keys).toHaveLength(27)
    Expect(keys).not.toContain('z')
    Expect(keys.filter(key => key.startsWith('z'))).toEqual(['za', 'zb'])
    Expect(
      keys.every((key, index) => keys.every((other, otherIndex) => index === otherIndex || !other.startsWith(key))),
    )
      .toBe(true)
  })

  Test('rejects stale, colliding, and newly excluded previous assignments', () => {
    const assignments = allocateInteractionKeys(
      [
        { identity: 'alpha', label: 'Alpha' },
        { identity: 'bravo', label: 'Bravo' },
        { identity: 'charlie', label: 'Charlie' },
      ],
      {
        explicitKeys: ['a'],
        previous: { alpha: 'z', bravo: 'b', charlie: 'b' },
      },
    )

    Expect(assignments).toEqual({ alpha: 'l', bravo: 'b', charlie: 'c' })
  })
})
