import { Errors } from '@shared'

type ShardableStep = object

type ShardableTestFile = {
  sourcePath: string
  suites: readonly {
    checks: readonly {
      steps: readonly ShardableStep[]
    }[]
  }[]
}

/** partitionTaoTestFiles balances whole source files without splitting their ordered checks. */
export function partitionTaoTestFiles<FileT extends ShardableTestFile>(
  files: readonly FileT[],
  shardCount: number,
): FileT[][] {
  if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 3) {
    Errors.throwHostEnvironment(`Tao test shard count must be an integer from 1 through 3, got ${shardCount}.`)
  }
  const shards = Array.from({ length: shardCount }, () => ({ files: [] as FileT[], weight: 0 }))
  const weighted = files.map(file => ({ file, weight: testFileWeight(file) })).sort((left, right) =>
    right.weight - left.weight || comparePaths(left.file.sourcePath, right.file.sourcePath)
  )
  for (const item of weighted) {
    const shard = shards.reduce((lightest, candidate) => candidate.weight < lightest.weight ? candidate : lightest)
    shard.files.push(item.file)
    shard.weight += item.weight
  }
  return shards.map(shard => shard.files.sort((left, right) => comparePaths(left.sourcePath, right.sourcePath)))
}

function testFileWeight(file: ShardableTestFile): number {
  return file.suites.reduce(
    (fileWeight, suite) =>
      fileWeight
      + suite.checks.reduce(
        (suiteWeight, check) => suiteWeight + 1 + stepsWeight(check.steps),
        0,
      ),
    0,
  )
}

function stepsWeight(steps: readonly ShardableStep[]): number {
  return steps.reduce((weight, step) => weight + 1 + stepsWeight(nestedSteps(step)), 0)
}

function nestedSteps(step: ShardableStep): readonly ShardableStep[] {
  if (!('steps' in step) || !Array.isArray(step.steps)) {
    return []
  }
  return step.steps as readonly ShardableStep[]
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
