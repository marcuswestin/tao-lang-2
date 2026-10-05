import { Describe, Expect, Test } from '@shared/test'
import { type PartitionUnit, VerifyPartition } from '../verification-src/VerifyPartition'

/**
 * A split lane is only sound if every machine places every unit the same way and each unit runs on
 * exactly one of them. These tests are about the ways a split could silently drop work.
 */

const UNITS: readonly PartitionUnit[] = [
  { expectedMs: 218_000, files: ['a.test.ts'], name: 'cli/tao-cli#5' },
  { expectedMs: 194_000, name: '_typecheck' },
  { expectedMs: 30_000, files: ['b.test.ts', 'c.test.ts'], name: 'parser#1' },
  { expectedMs: 30_000, files: ['d.test.ts'], name: 'parser#2' },
  { name: 'dead-exports' },
]

Describe('verify partition', () => {
  Test('every unit runs on exactly one machine of the split', () => {
    const plans = [0, 1, 2].map(index => VerifyPartition.plan(UNITS, { count: 3, index }))

    for (const unit of UNITS) {
      Expect(plans.filter(partition => VerifyPartition.owns(partition, unit.name)).length).toBe(1)
    }
  })

  Test('every machine computes the same digest, whatever order it listed the units in', () => {
    const first = VerifyPartition.plan(UNITS, { count: 3, index: 0 })
    const second = VerifyPartition.plan([...UNITS].reverse(), { count: 3, index: 2 })

    Expect(second.digest).toBe(first.digest)
    Expect(new Map(second.placement)).toEqual(new Map(first.placement))
  })

  Test('a shard covering different files is a different plan', () => {
    const first = VerifyPartition.plan(UNITS, { count: 3, index: 0 })
    const moved = UNITS.map(unit => unit.name === 'parser#2' ? { ...unit, files: ['d.test.ts', 'e.test.ts'] } : unit)

    Expect(VerifyPartition.plan(moved, { count: 3, index: 0 }).digest).not.toBe(first.digest)
  })

  Test('the two slowest units land on different machines', () => {
    const partition = VerifyPartition.plan(UNITS, { count: 2, index: 0 })

    Expect(partition.placement.get('cli/tao-cli#5')).not.toBe(partition.placement.get('_typecheck'))
  })

  Test('the flag is one-based for people and refuses an index past the count', () => {
    Expect(VerifyPartition.parse('2/8')).toEqual({ count: 8, index: 1 })
    Expect(() => VerifyPartition.parse('0/8')).toThrow()
    Expect(() => VerifyPartition.parse('9/8')).toThrow()
    Expect(() => VerifyPartition.parse('two')).toThrow()
  })
})
