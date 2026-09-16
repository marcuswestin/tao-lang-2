import { Describe, Expect, Test } from '@shared/test'
import { partitionTaoTestFiles } from './tao-test-sharding'

const { taoTestShardCount } = require('./tao-test-shard-config.cjs') as {
  taoTestShardCount(rawCount?: string): number
}

type TestStep = {
  steps?: TestStep[]
}

type TestFile = {
  sourcePath: string
  suites: { checks: { steps: TestStep[] }[] }[]
}

function file(sourcePath: string, weight: number): TestFile {
  return {
    sourcePath,
    suites: [{ checks: [{ steps: Array.from({ length: weight - 1 }, () => ({})) }] }],
  }
}

function paths(shards: readonly (readonly TestFile[])[]): string[][] {
  return shards.map(shard => shard.map(item => item.sourcePath))
}

const files = [
  file('/tests/F.test.tao', 3),
  file('/tests/B.test.tao', 7),
  file('/tests/D.test.tao', 5),
  file('/tests/A.test.tao', 8),
  file('/tests/E.test.tao', 4),
  file('/tests/C.test.tao', 6),
]

Describe('Tao test sharding', () => {
  Test('covers every file exactly once across one, two, and three deterministic balanced shards', () => {
    Expect(paths(partitionTaoTestFiles(files, 1))).toEqual([
      [
        '/tests/A.test.tao',
        '/tests/B.test.tao',
        '/tests/C.test.tao',
        '/tests/D.test.tao',
        '/tests/E.test.tao',
        '/tests/F.test.tao',
      ],
    ])
    Expect(paths(partitionTaoTestFiles(files, 2))).toEqual([
      ['/tests/A.test.tao', '/tests/D.test.tao', '/tests/E.test.tao'],
      ['/tests/B.test.tao', '/tests/C.test.tao', '/tests/F.test.tao'],
    ])
    Expect(paths(partitionTaoTestFiles(files, 3))).toEqual([
      ['/tests/A.test.tao', '/tests/F.test.tao'],
      ['/tests/B.test.tao', '/tests/E.test.tao'],
      ['/tests/C.test.tao', '/tests/D.test.tao'],
    ])
    const covered = partitionTaoTestFiles(files, 3).flat().map(item => item.sourcePath).sort()
    Expect(covered).toEqual(files.map(item => item.sourcePath).sort())
  })

  Test('uses source path and then shard index to break equal-weight ties', () => {
    const tied = [
      file('/tests/D.test.tao', 2),
      file('/tests/C.test.tao', 2),
      file('/tests/A.test.tao', 2),
      file('/tests/B.test.tao', 2),
    ]

    Expect(paths(partitionTaoTestFiles(tied, 2))).toEqual([
      ['/tests/A.test.tao', '/tests/C.test.tao'],
      ['/tests/B.test.tao', '/tests/D.test.tao'],
    ])
  })

  Test('defaults the Jest config to one shard and rejects invalid child contracts', () => {
    Expect(taoTestShardCount()).toBe(1)
    Expect(taoTestShardCount('1')).toBe(1)
    Expect(taoTestShardCount('2')).toBe(2)
    Expect(taoTestShardCount('3')).toBe(3)
    for (const invalid of ['', '0', '4', '1.5', '01', 'many']) {
      Expect(() => taoTestShardCount(invalid)).toThrow(
        `TAO_TEST_SHARD_COUNT must be an integer from 1 through 3, got ${JSON.stringify(invalid)}.`,
      )
    }
  })
})
